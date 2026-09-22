<script setup lang="ts">
import type {
  ActionResponse,
  ProjectDetailResponse,
  ProjectLogEndEvent,
  ProjectLogEvent,
  ProjectLogFailureEvent,
  ProjectState,
  StartOperationResponse,
} from "~~/shared/types/projects";
import { appendLogText } from "~~/shared/utils/logs";
import { hostnameFromUrl } from "~~/shared/utils/projects";

type ConnectionStatus = "idle" | "starting" | "connecting" | "live" | "ended" | "error";
type StreamPhase = "operation" | "runtime";

const route = useRoute();
const router = useRouter();
const config = useRuntimeConfig();
const requestUrl = useRequestURL();
const projectId = computed(() => {
  const value = route.params.id;
  return Array.isArray(value) ? value[0] || "" : value || "";
});
const operationId = computed(() => {
  const value = route.query.operation;
  return Array.isArray(value) ? value[0] || "" : value || "";
});
const isManager = requestUrl.hostname.toLowerCase() === hostnameFromUrl(config.public.managerOrigin);
const { data, error, refresh, status } = await useFetch<ProjectDetailResponse>(
  () => `/api/projects/${encodeURIComponent(projectId.value)}`,
  { immediate: isManager },
);
const project = computed(() => data.value?.project);

if (import.meta.server && (!isManager || error.value?.statusCode === 404)) {
  const event = useRequestEvent();
  if (event) setResponseStatus(event, 404);
}

const connectionStatus = ref<ConnectionStatus>("idle");
const streamPhase = ref<StreamPhase>(operationId.value ? "operation" : "runtime");
const canStartAgain = ref(false);
const startRequestPending = ref(false);
const stopRequestPending = ref(false);
const actionPending = computed(() => startRequestPending.value || stopRequestPending.value || connectionStatus.value === "starting");
const failureMessage = ref<string>();
const logText = ref("");
const hasUnreadLogs = ref(false);
const logViewport = useTemplateRef<HTMLElement>("logViewport");
let source: EventSource | undefined;

const statePresentation: Record<ProjectState, {
  label: string;
  color: "success" | "neutral" | "warning" | "error";
}> = {
  running: { label: "Running", color: "success" },
  stopped: { label: "Stopped", color: "neutral" },
  degraded: { label: "Degraded", color: "warning" },
  invalid: { label: "Invalid", color: "error" },
};

const toast = useToast();

const statusPresentation: Record<ConnectionStatus, {
  label: string;
  color: "neutral" | "warning" | "success" | "error";
}> = {
  idle: { label: "Idle", color: "neutral" },
  starting: { label: "Starting", color: "warning" },
  connecting: { label: "Connecting", color: "warning" },
  live: { label: "Live", color: "success" },
  ended: { label: "Ended", color: "neutral" },
  error: { label: "Error", color: "error" },
};

function responseError(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const response = value as { data?: { data?: { message?: string }; message?: string }; message?: string };
    return response.data?.data?.message || response.data?.message || response.message || "Operation failed";
  }
  return "Operation failed";
}

function eventData<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
}

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 48;
}

function jumpToLatest(): void {
  void nextTick(() => {
    const element = logViewport.value;
    if (element) element.scrollTop = element.scrollHeight;
    hasUnreadLogs.value = false;
  });
}

function appendOutput(text: string): void {
  const shouldFollow = !logViewport.value || isNearBottom(logViewport.value);
  logText.value = appendLogText(logText.value, text);
  if (shouldFollow) jumpToLatest();
  else hasUnreadLogs.value = true;
}

function clearLogs(): void {
  logText.value = "";
  hasUnreadLogs.value = false;
}

function disconnect(): void {
  source?.close();
  source = undefined;
}

function connectRuntime(): void {
  if (!project.value || project.value.state === "invalid" || !isManager) return;

  disconnect();
  streamPhase.value = "runtime";
  canStartAgain.value = false;
  connectionStatus.value = "connecting";
  failureMessage.value = undefined;
  const nextSource = new EventSource(`/api/projects/${encodeURIComponent(project.value.id)}/logs`);
  source = nextSource;

  nextSource.addEventListener("open", () => {
    if (source === nextSource) connectionStatus.value = "live";
  });
  nextSource.addEventListener("log", (event) => {
    if (source !== nextSource) return;
    try {
      const message = eventData<ProjectLogEvent>(event);
      appendOutput(message.text);
    } catch {
      failureMessage.value = "The server returned an invalid log event.";
      connectionStatus.value = "error";
      disconnect();
    }
  });
  nextSource.addEventListener("end", (event) => {
    if (source !== nextSource) return;
    const result = eventData<ProjectLogEndEvent>(event);
    connectionStatus.value = result.code === 0 ? "ended" : "error";
    if (result.code !== 0) {
      failureMessage.value = result.signal
        ? `Log command ended with signal ${result.signal}.`
        : `Log command exited with code ${result.code ?? "unknown"}.`;
    }
    disconnect();
  });
  nextSource.addEventListener("failure", (event) => {
    if (source !== nextSource) return;
    const result = eventData<ProjectLogFailureEvent>(event);
    connectionStatus.value = "error";
    failureMessage.value = result.message;
    disconnect();
  });
  nextSource.onerror = () => {
    if (source !== nextSource) return;
    connectionStatus.value = "error";
    failureMessage.value = "The live log connection was interrupted.";
    disconnect();
  };
}

function connectOperation(): void {
  if (!project.value || !operationId.value || !isManager) return;

  disconnect();
  streamPhase.value = "operation";
  canStartAgain.value = false;
  connectionStatus.value = "starting";
  failureMessage.value = undefined;
  const nextSource = new EventSource(
    `/api/projects/${encodeURIComponent(project.value.id)}/operations/${encodeURIComponent(operationId.value)}`,
  );
  source = nextSource;

  nextSource.addEventListener("reset", () => {
    if (source === nextSource) clearLogs();
  });
  nextSource.addEventListener("log", (event) => {
    if (source !== nextSource) return;
    try {
      const message = eventData<ProjectLogEvent>(event);
      appendOutput(message.text);
    } catch {
      failureMessage.value = "The server returned an invalid startup log event.";
      connectionStatus.value = "error";
      disconnect();
    }
  });
  nextSource.addEventListener("end", (event) => {
    if (source !== nextSource) return;
    const result = eventData<ProjectLogEndEvent>(event);
    disconnect();
    void refresh();
    if (result.code === 0) {
      appendOutput("\n--- Project started; following container logs ---\n");
      connectRuntime();
      return;
    }
    connectionStatus.value = "error";
    canStartAgain.value = true;
    failureMessage.value = result.signal
      ? `Project start ended with signal ${result.signal}.`
      : `Project start exited with code ${result.code ?? "unknown"}.`;
  });
  nextSource.addEventListener("failure", (event) => {
    if (source !== nextSource) return;
    const result = eventData<ProjectLogFailureEvent>(event);
    disconnect();
    void refresh();
    connectionStatus.value = "error";
    canStartAgain.value = true;
    failureMessage.value = result.message;
  });
  nextSource.onerror = () => {
    if (source !== nextSource) return;
    connectionStatus.value = "error";
    failureMessage.value = "The startup log is unavailable or disconnected. The project continues independently.";
    disconnect();
    void refresh();
  };
}

function reconnect(): void {
  if (streamPhase.value === "operation" && operationId.value) connectOperation();
  else connectRuntime();
}

async function startProject(): Promise<void> {
  if (!project.value) return;
  disconnect();
  clearLogs();
  startRequestPending.value = true;
  failureMessage.value = undefined;
  try {
    const result = await $fetch<StartOperationResponse>(
      `/api/projects/${encodeURIComponent(project.value.id)}/up`,
      { method: "POST", body: {} },
    );
    canStartAgain.value = false;
    await router.replace({ query: { operation: result.operationId } });
    connectOperation();
  } catch (cause) {
    connectionStatus.value = "error";
    canStartAgain.value = true;
    failureMessage.value = responseError(cause);
  } finally {
    startRequestPending.value = false;
  }
}

async function stopProject(): Promise<void> {
  if (!project.value) return;
  stopRequestPending.value = true;
  try {
    await $fetch<ActionResponse>(`/api/projects/${encodeURIComponent(project.value.id)}/down`, {
      method: "POST",
      body: {},
    });
    disconnect();
    connectionStatus.value = "ended";
    canStartAgain.value = false;
    failureMessage.value = undefined;
    await router.replace({ query: {} });
    await refresh();
    toast.add({ title: "Project stopped", color: "success" });
  } catch (cause) {
    toast.add({ title: "Could not stop project", description: responseError(cause), color: "error" });
  } finally {
    stopRequestPending.value = false;
  }
}

function trackScroll(): void {
  const element = logViewport.value;
  if (element && isNearBottom(element)) hasUnreadLogs.value = false;
}

onMounted(() => {
  if (operationId.value) connectOperation();
  else connectRuntime();
});
onBeforeUnmount(disconnect);
</script>

<template>
  <UContainer as="main" class="flex min-h-screen flex-col py-6 sm:py-10">
    <UPageHeader
      headline="Youngmedia Bench"
      :title="project?.name || project?.id || projectId"
      description="Project controls and live logs."
    >
      <template #links>
        <UBadge
          v-if="project"
          :color="statePresentation[project.state].color"
          variant="subtle"
        >
          {{ statePresentation[project.state].label }}
        </UBadge>
        <UButton to="/" color="neutral" variant="outline">
          Back to projects
        </UButton>
      </template>
    </UPageHeader>

    <USkeleton v-if="status === 'pending' && !data" class="mt-8 h-[60vh]" />

    <UEmpty
      v-else-if="!isManager"
      class="mt-8"
      title="Project details are only available in Bench Manager"
      description="Open Bench Manager to view this project."
    >
      <template #actions>
        <UButton :to="config.public.managerOrigin" external>
          Open Bench Manager
        </UButton>
      </template>
    </UEmpty>

    <UEmpty
      v-else-if="error"
      class="mt-8"
      :title="error.statusCode === 404 ? 'Project not found' : 'Could not load the project'"
      :description="error.statusCode === 404
        ? 'This project is no longer available in Bench Manager.'
        : responseError(error)"
    />

    <template v-else-if="project">
      <div class="mt-6 flex flex-wrap items-center gap-2">
        <UButton
          :loading="startRequestPending"
          :disabled="actionPending || project.state === 'invalid' || project.state === 'running'"
          @click="startProject"
        >
          {{ canStartAgain ? "Start again" : "Start" }}
        </UButton>
        <UButton
          color="error"
          variant="soft"
          :loading="stopRequestPending"
          :disabled="actionPending || project.state === 'invalid' || project.state === 'stopped'"
          @click="stopProject"
        >
          Stop
        </UButton>
        <UButton :to="data?.vscodeUri" :disabled="!data?.vscodeUri" external color="neutral" variant="outline">
          Open in VS Code
        </UButton>
      </div>

      <UAlert
        v-if="project.error"
        class="mt-6"
        :color="project.state === 'invalid' ? 'error' : 'warning'"
        variant="subtle"
        :title="project.state === 'invalid' ? 'Project configuration is invalid' : 'Project state is inconsistent'"
        :description="project.error"
      />

      <ul v-if="project.routes.length" class="mt-6 space-y-2">
        <li v-for="projectRoute in project.routes" :key="projectRoute">
          <ULink :to="projectRoute" external target="_blank" class="break-all text-sm">
            {{ projectRoute }}
          </ULink>
        </li>
      </ul>

      <template v-if="project.state !== 'invalid'">
        <UAlert
          v-if="failureMessage"
          class="mt-6"
          color="error"
          variant="subtle"
          :title="canStartAgain ? 'Project start failed' : 'Log stream stopped'"
          :description="failureMessage"
        />

        <div class="mt-6 flex flex-wrap items-center gap-2">
          <UBadge :color="statusPresentation[connectionStatus].color" variant="subtle">
            Logs: {{ statusPresentation[connectionStatus].label }}
          </UBadge>
          <UButton
            color="neutral"
            variant="outline"
            :loading="connectionStatus === 'connecting' || connectionStatus === 'starting'"
            :disabled="connectionStatus === 'connecting' || connectionStatus === 'starting' || connectionStatus === 'live'"
            @click="reconnect"
          >
            {{ connectionStatus === "starting" ? "Starting" : "Reconnect" }}
          </UButton>
          <UButton color="neutral" variant="ghost" :disabled="!logText" @click="clearLogs">
            Clear
          </UButton>
          <UButton
            v-if="hasUnreadLogs"
            color="neutral"
            variant="soft"
            @click="jumpToLatest"
          >
            Jump to latest
          </UButton>
        </div>

        <UCard class="mt-4 min-h-0 flex-1" :ui="{ body: 'p-0 sm:p-0' }">
          <div
            ref="logViewport"
            class="h-[65vh] overflow-auto p-4 font-mono text-xs leading-5"
            @scroll.passive="trackScroll"
          >
            <pre v-if="logText" class="min-w-max whitespace-pre text-default">{{ logText }}</pre>
            <UEmpty
              v-else
              :title="connectionStatus === 'ended' ? 'No logs returned' : 'Waiting for output'"
              :description="connectionStatus === 'ended'
                ? 'The current project containers do not have any available logs.'
                : 'New output will appear here automatically.'"
            />
          </div>
        </UCard>
      </template>
    </template>

    <UEmpty
      v-else
      class="mt-8"
      title="Project not found"
      description="This project is no longer available in Bench Manager."
    />
  </UContainer>
</template>
