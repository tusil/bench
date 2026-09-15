<script setup lang="ts">
import type {
  ProjectLogEndEvent,
  ProjectLogEvent,
  ProjectLogFailureEvent,
  ProjectsResponse,
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
const { data, error, status } = await useFetch<ProjectsResponse>("/api/projects");
const project = computed(() => data.value?.projects.find((candidate) => candidate.id === projectId.value));

if (import.meta.server && (!isManager || (data.value && !project.value))) {
  const event = useRequestEvent();
  if (event) setResponseStatus(event, 404);
}

const connectionStatus = ref<ConnectionStatus>("idle");
const streamPhase = ref<StreamPhase>(operationId.value ? "operation" : "runtime");
const canStartAgain = ref(false);
const startRequestPending = ref(false);
const failureMessage = ref<string>();
const logText = ref("");
const hasUnreadLogs = ref(false);
const logViewport = useTemplateRef<HTMLElement>("logViewport");
let source: EventSource | undefined;

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
    connectionStatus.value = "error";
    canStartAgain.value = true;
    failureMessage.value = result.message;
  });
  nextSource.onerror = () => {
    if (source !== nextSource) return;
    connectionStatus.value = "error";
    failureMessage.value = "The startup log is unavailable or disconnected. The project continues independently.";
    disconnect();
  };
}

function reconnect(): void {
  if (streamPhase.value === "operation" && operationId.value) connectOperation();
  else connectRuntime();
}

async function startAgain(): Promise<void> {
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
      :title="`Logs · ${project?.name || project?.id || projectId}`"
      description="Live startup and runtime output for this Compose project."
    >
      <template #links>
        <UBadge
          v-if="project && project.state !== 'invalid'"
          :color="statusPresentation[connectionStatus].color"
          variant="subtle"
        >
          {{ statusPresentation[connectionStatus].label }}
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
      title="Project logs are only available in Bench Manager"
      description="Open Bench Manager to view this project's logs."
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
      title="Could not load the project"
      :description="responseError(error)"
    />

    <UEmpty
      v-else-if="!project"
      class="mt-8"
      title="Project not found"
      description="This project is no longer available in Bench Manager."
    />

    <UEmpty
      v-else-if="project.state === 'invalid'"
      class="mt-8"
      title="Project configuration is invalid"
      :description="project.error || 'Fix bench.yml before viewing logs.'"
    />

    <template v-else>
      <UAlert
        v-if="failureMessage"
        class="mt-6"
        color="error"
        variant="subtle"
        :title="canStartAgain ? 'Project start failed' : 'Log stream stopped'"
        :description="failureMessage"
      />

      <div class="mt-6 flex flex-wrap items-center gap-2">
        <UButton
          v-if="canStartAgain"
          :loading="startRequestPending"
          :disabled="startRequestPending"
          @click="startAgain"
        >
          Start again
        </UButton>
        <UButton
          v-else
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
  </UContainer>
</template>
