<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import type {
  ActionResponse,
  ProjectListItem,
  ProjectLogEndEvent,
  ProjectLogFailureEvent,
  ProjectState,
  ProjectsResponse,
  StartOperationResponse,
} from "~~/shared/types/projects";
import type { CapacityUsage, ProjectResourceUsage, ResourcesResponse } from "~~/shared/types/resources";
import {
  findProjectByHostname,
  hostnameFromUrl,
} from "~~/shared/utils/projects";

const toast = useToast();
const config = useRuntimeConfig();
const requestUrl = useRequestURL();
const activeProject = ref<string>();
const { data, error, refresh, status } = await useFetch<ProjectsResponse>("/api/projects");

const managerOrigin = config.public.managerOrigin;
const isDashboard = requestUrl.hostname.toLowerCase() === hostnameFromUrl(managerOrigin);
const {
  data: resources,
  error: resourcesError,
  refresh: refreshResources,
  status: resourcesStatus,
} = await useFetch<ResourcesResponse>("/api/resources", { immediate: isDashboard });
const dashboardRefreshing = ref(false);

const routedProject = computed(() => data.value
  ? findProjectByHostname(data.value.projects, requestUrl.hostname)
  : undefined);
const projectResources = computed(() => new Map(
  resources.value?.projects.map((project) => [project.id, project]) || [],
));
const regularProjects = computed(() => data.value?.projects
  .filter((project) => !project.id.startsWith("bench-template-")) || []);
const templateProjects = computed(() => data.value?.projects
  .filter((project) => project.id.startsWith("bench-template-")) || []);
const projectSections = computed(() => [
  ...(regularProjects.value.length ? [{ title: "Projects", projects: regularProjects.value }] : []),
  ...(templateProjects.value.length ? [{ title: "Templates", projects: templateProjects.value }] : []),
]);
const dashboardAction = ref<{ projectId: string; action: "start" | "stop" }>();
let startSource: EventSource | undefined;

if (import.meta.server && !isDashboard && data.value && !routedProject.value) {
  const event = useRequestEvent();
  if (event) setResponseStatus(event, 404);
}

const statePresentation: Record<ProjectState, {
  label: string;
  color: "success" | "neutral" | "warning" | "error";
}> = {
  running: { label: "Running", color: "success" },
  stopped: { label: "Stopped", color: "neutral" },
  degraded: { label: "Degraded", color: "warning" },
  invalid: { label: "Invalid", color: "error" },
};

function responseError(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const response = value as { data?: { data?: { message?: string }; message?: string }; message?: string };
    return response.data?.data?.message || response.data?.message || response.message || "Operation failed";
  }
  return "Operation failed";
}

function conciseError(value: unknown): string {
  const message = responseError(value).split("\n")[0] || "Operation failed";
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

const numberFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

function formatPercent(value: number): string {
  return `${numberFormatter.format(value)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${numberFormatter.format(bytes / 1024 ** unit)} ${units[unit]}`;
}

function capacityPercent(capacity: CapacityUsage): number {
  return capacity.totalBytes === 0 ? 0 : Math.min(100, capacity.usedBytes / capacity.totalBytes * 100);
}

function projectUsage(id: string): ProjectResourceUsage | undefined {
  return projectResources.value.get(id);
}

function projectCpu(id: string): string {
  const usage = projectUsage(id);
  return usage?.available ? formatPercent(usage.cpuPercent) : resourcesStatus.value === "pending" ? "Loading..." : "Unavailable";
}

function projectMemory(id: string): string {
  const usage = projectUsage(id);
  return usage?.available ? formatBytes(usage.memoryUsedBytes) : resourcesStatus.value === "pending" ? "Loading..." : "Unavailable";
}

function projectActionPending(project: ProjectListItem): boolean {
  return dashboardAction.value?.projectId === project.id;
}

function projectStateLabel(project: ProjectListItem): string {
  if (!projectActionPending(project)) return statePresentation[project.state].label;
  return dashboardAction.value?.action === "start" ? "Starting..." : "Stopping...";
}

function projectStateColor(project: ProjectListItem): "success" | "neutral" | "warning" | "error" {
  return projectActionPending(project) ? "warning" : statePresentation[project.state].color;
}

function stateMenuItems(project: ProjectListItem): DropdownMenuItem[] {
  if (project.state === "invalid") return [];
  if (project.state === "stopped") {
    return [{
      label: "Start",
      icon: "i-lucide-play",
      onSelect: () => void startDashboardProject(project.id),
    }];
  }
  if (project.state === "running") {
    return [{
      label: "Stop",
      icon: "i-lucide-square",
      color: "error",
      onSelect: () => void stopDashboardProject(project.id),
    }];
  }
  return [{
    label: "Start again",
    icon: "i-lucide-rotate-cw",
    onSelect: () => void startDashboardProject(project.id),
  }, {
    label: "Stop",
    icon: "i-lucide-square",
    color: "error",
    onSelect: () => void stopDashboardProject(project.id),
  }];
}

function addressMenuItems(project: ProjectListItem): DropdownMenuItem[] {
  return project.routes.map((route) => ({
    label: route,
    icon: "i-lucide-external-link",
    to: route,
    target: "_blank",
    external: true,
  }));
}

async function refreshDashboard(): Promise<void> {
  dashboardRefreshing.value = true;
  try {
    await Promise.all([refresh(), refreshResources({ dedupe: "defer" })]);
  } finally {
    dashboardRefreshing.value = false;
  }
}

function monitorProjectStart(id: string, operationId: string): void {
  startSource?.close();
  const source = new EventSource(
    `/api/projects/${encodeURIComponent(id)}/operations/${encodeURIComponent(operationId)}`,
  );
  startSource = source;
  let settled = false;

  async function finish(success: boolean, description?: string): Promise<void> {
    if (settled) return;
    settled = true;
    source.close();
    if (startSource === source) startSource = undefined;
    try {
      await refreshDashboard();
      toast.add(success
        ? { title: "Project started", color: "success" }
        : { title: "Could not start project", description, color: "error" });
    } finally {
      if (dashboardAction.value?.projectId === id && dashboardAction.value.action === "start") {
        dashboardAction.value = undefined;
      }
    }
  }

  source.addEventListener("end", (event) => {
    try {
      const result = JSON.parse((event as MessageEvent<string>).data) as ProjectLogEndEvent;
      const description = result.signal
        ? `Project start ended with signal ${result.signal}.`
        : `Project start exited with code ${result.code ?? "unknown"}.`;
      void finish(result.code === 0, result.code === 0 ? undefined : description);
    } catch {
      void finish(false, "The server returned an invalid operation result.");
    }
  });
  source.addEventListener("failure", (event) => {
    try {
      const result = JSON.parse((event as MessageEvent<string>).data) as ProjectLogFailureEvent;
      void finish(false, result.message);
    } catch {
      void finish(false, "The server returned an invalid operation failure.");
    }
  });
  source.onerror = () => {
    void finish(false, "The start status connection was interrupted. The project may still be starting.");
  };
}

async function startDashboardProject(id: string): Promise<void> {
  if (dashboardAction.value) return;
  dashboardAction.value = { projectId: id, action: "start" };
  try {
    const result = await $fetch<StartOperationResponse>(`/api/projects/${encodeURIComponent(id)}/up`, {
      method: "POST",
      body: {},
    });
    monitorProjectStart(id, result.operationId);
  } catch (cause) {
    dashboardAction.value = undefined;
    toast.add({ title: "Could not start project", description: conciseError(cause), color: "error" });
  }
}

async function stopDashboardProject(id: string): Promise<void> {
  if (dashboardAction.value) return;
  dashboardAction.value = { projectId: id, action: "stop" };
  try {
    await $fetch<ActionResponse>(`/api/projects/${encodeURIComponent(id)}/down`, {
      method: "POST",
      body: {},
    });
    await refreshDashboard();
    toast.add({ title: "Project stopped", color: "success" });
  } catch (cause) {
    toast.add({ title: "Could not stop project", description: conciseError(cause), color: "error" });
  } finally {
    dashboardAction.value = undefined;
  }
}

async function pollResources(): Promise<void> {
  if (!isDashboard || document.hidden || resourcesStatus.value === "pending") return;
  await refreshResources({ dedupe: "defer" });
}

function handleVisibilityChange(): void {
  if (!document.hidden) void pollResources();
}

let resourcesTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  if (!isDashboard) return;
  resourcesTimer = setInterval(() => void pollResources(), 5_000);
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onBeforeUnmount(() => {
  startSource?.close();
  if (resourcesTimer) clearInterval(resourcesTimer);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});

async function start(id: string) {
  activeProject.value = id;
  try {
    const result = await $fetch<StartOperationResponse>(`/api/projects/${encodeURIComponent(id)}/up`, {
      method: "POST",
      body: {},
    });
    const path = `/projects/${encodeURIComponent(id)}?operation=${encodeURIComponent(result.operationId)}`;
    if (isDashboard) await navigateTo(path);
    else window.location.assign(new URL(path, managerOrigin).toString());
  } catch (cause) {
    toast.add({ title: "Could not start project", description: conciseError(cause), color: "error" });
  } finally {
    activeProject.value = undefined;
  }
}
</script>

<template>
  <div>
    <UContainer v-if="isDashboard" as="main" class="min-h-screen py-10">
      <UPageHeader
        headline="Youngmedia"
        title="Bench"
        description="Projects available on this development server."
      >
        <template #links>
          <UButton
            color="neutral"
            variant="outline"
            :loading="dashboardRefreshing"
            :disabled="Boolean(activeProject) || Boolean(dashboardAction)"
            @click="refreshDashboard"
          >
            Refresh
          </UButton>
        </template>
      </UPageHeader>

      <UAlert
        v-if="error"
        class="mt-8"
        color="error"
        variant="subtle"
        title="Could not load projects"
        :description="responseError(error)"
      />

      <UAlert
        v-if="resourcesError"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load system resources"
        :description="responseError(resourcesError)"
      />

      <UPageGrid v-if="resourcesStatus === 'pending' && !resources" class="mt-8">
        <USkeleton v-for="index in 3" :key="index" class="h-44" />
      </UPageGrid>

      <UPageGrid v-else-if="resources" class="mt-8">
        <UCard>
          <p class="text-sm text-muted">
            CPU
          </p>
          <div class="mt-2 flex items-end justify-between gap-4">
            <p class="text-2xl font-semibold">
              {{ formatPercent(resources.system.cpu.usagePercent) }}
            </p>
            <p class="text-sm text-muted">
              {{ resources.system.cpu.logicalCores }} logical cores
            </p>
          </div>
          <UProgress
            class="mt-4"
            size="sm"
            :model-value="resources.system.cpu.usagePercent"
          />
        </UCard>

        <UCard>
          <p class="text-sm text-muted">
            Memory
          </p>
          <div class="mt-2 flex items-baseline justify-between gap-4">
            <p class="font-semibold">
              RAM
            </p>
            <p class="text-sm">
              {{ formatBytes(resources.system.memory.usedBytes) }} /
              {{ formatBytes(resources.system.memory.totalBytes) }}
            </p>
          </div>
          <UProgress
            class="mt-2"
            size="sm"
            :model-value="capacityPercent(resources.system.memory)"
          />
          <div class="mt-4 flex items-baseline justify-between gap-4">
            <p class="font-semibold">
              Swap
            </p>
            <p v-if="resources.system.swap.totalBytes" class="text-sm">
              {{ formatBytes(resources.system.swap.usedBytes) }} /
              {{ formatBytes(resources.system.swap.totalBytes) }}
            </p>
            <p v-else class="text-sm text-muted">
              Not configured
            </p>
          </div>
          <UProgress
            v-if="resources.system.swap.totalBytes"
            class="mt-2"
            size="sm"
            :model-value="capacityPercent(resources.system.swap)"
          />
        </UCard>

        <UCard>
          <p class="text-sm text-muted">
            Projects disk
          </p>
          <p class="mt-2 text-2xl font-semibold">
            {{ formatPercent(capacityPercent(resources.system.disk)) }}
          </p>
          <UProgress
            class="mt-4"
            size="sm"
            :model-value="capacityPercent(resources.system.disk)"
          />
          <p class="mt-3 text-sm text-muted">
            {{ formatBytes(resources.system.disk.usedBytes) }} /
            {{ formatBytes(resources.system.disk.totalBytes) }}
          </p>
        </UCard>
      </UPageGrid>

      <UPageGrid v-if="status === 'pending' && !data" class="mt-8">
        <USkeleton v-for="index in 4" :key="index" class="h-56" />
      </UPageGrid>

      <UEmpty
        v-else-if="data?.projects.length === 0"
        class="mt-8"
        title="No Bench projects found"
        description="Add a bench.yml file to a direct subdirectory of the configured projects directory."
      />

      <template v-else>
        <section v-for="section in projectSections" :key="section.title" class="mt-8">
          <h2 class="text-lg font-semibold">
            {{ section.title }}
          </h2>

          <UPageGrid class="mt-4">
            <UCard
              v-for="project in section.projects"
              :key="project.id"
              class="flex flex-col"
              :ui="{ header: 'flex-1' }"
            >
              <template #header>
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <h3 class="truncate font-semibold">
                      {{ project.name || project.id }}
                    </h3>
                    <p v-if="project.name && project.name !== project.id" class="truncate text-xs text-muted">
                      {{ project.id }}
                    </p>
                  </div>

                  <UDropdownMenu
                    :items="stateMenuItems(project)"
                    :disabled="Boolean(dashboardAction) || project.state === 'invalid'"
                    :content="{ align: 'end' }"
                  >
                    <UButton
                      size="xs"
                      variant="subtle"
                      :color="projectStateColor(project)"
                      :loading="projectActionPending(project)"
                      :trailing-icon="project.state === 'invalid' ? undefined : 'i-lucide-chevron-down'"
                    >
                      {{ projectStateLabel(project) }}
                    </UButton>
                  </UDropdownMenu>
                </div>

                <UAlert
                  v-if="project.error"
                  class="mt-4"
                  :color="project.state === 'invalid' ? 'error' : 'warning'"
                  variant="subtle"
                  :title="project.state === 'invalid' ? 'Project configuration is invalid' : 'Project state is inconsistent'"
                  :description="project.error"
                />
              </template>

              <template #footer>
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <dl class="flex min-w-0 items-center gap-4">
                    <div>
                      <dt class="text-xs text-muted">
                        CPU
                      </dt>
                      <dd class="text-sm font-medium">
                        {{ projectCpu(project.id) }}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-xs text-muted">
                        RAM
                      </dt>
                      <dd class="text-sm font-medium">
                        {{ projectMemory(project.id) }}
                      </dd>
                    </div>
                  </dl>

                  <div class="ml-auto flex items-center gap-1">
                    <UTooltip text="View details and logs">
                      <UButton
                        :to="`/projects/${encodeURIComponent(project.id)}`"
                        icon="i-lucide-file-text"
                        color="neutral"
                        variant="ghost"
                        square
                        aria-label="View details and logs"
                      />
                    </UTooltip>

                    <UTooltip text="Open in VS Code">
                      <UButton
                        :to="project.vscodeUri"
                        :disabled="!project.vscodeUri"
                        icon="i-lucide-code-xml"
                        color="neutral"
                        variant="ghost"
                        square
                        external
                        aria-label="Open in VS Code"
                      />
                    </UTooltip>

                    <UDropdownMenu
                      :items="addressMenuItems(project)"
                      :disabled="project.routes.length === 0"
                      :content="{ align: 'end' }"
                    >
                      <UTooltip text="Open project address">
                        <UButton
                          icon="i-lucide-globe"
                          color="neutral"
                          variant="ghost"
                          square
                          :disabled="project.routes.length === 0"
                          aria-label="Open project address"
                        />
                      </UTooltip>
                    </UDropdownMenu>
                  </div>
                </div>
              </template>
            </UCard>
          </UPageGrid>
        </section>
      </template>
    </UContainer>

    <UContainer
      v-else
      as="main"
      class="flex min-h-screen max-w-xl flex-col justify-center py-10"
    >
      <ULink :to="managerOrigin" external class="mb-6 w-fit text-sm font-medium">
        Youngmedia Bench
      </ULink>

      <USkeleton v-if="status === 'pending' && !data" class="h-72" />

      <UEmpty
        v-else-if="error"
        title="Project status is unavailable"
        :description="responseError(error)"
      >
        <template #actions>
          <UButton :loading="status === 'pending'" @click="refresh()">
            Retry
          </UButton>
          <UButton :to="managerOrigin" color="neutral" variant="outline" external>
            Open Bench Manager
          </UButton>
        </template>
      </UEmpty>

      <UCard v-else-if="routedProject">
        <template #header>
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-sm text-muted">
                Project
              </p>
              <h1 class="mt-1 text-xl font-semibold">
                {{ routedProject.name || routedProject.id }}
                {{ routedProject.state === "degraded" ? "needs attention" : "is not running" }}
              </h1>
            </div>
            <UBadge :color="statePresentation[routedProject.state].color" variant="subtle">
              {{ statePresentation[routedProject.state].label }}
            </UBadge>
          </div>
        </template>

        <p class="text-sm text-muted">
          Start the project to continue to this address.
        </p>
        <UAlert
          v-if="routedProject.error"
          class="mt-4"
          color="warning"
          variant="subtle"
          title="Project state is inconsistent"
          :description="routedProject.error"
        />

        <template #footer>
          <div class="flex flex-wrap gap-2">
            <UButton
              :loading="activeProject === routedProject.id"
              :disabled="Boolean(activeProject)"
              @click="start(routedProject.id)"
            >
              {{ routedProject.state === "degraded" ? "Start again" : "Start project" }}
            </UButton>
            <UButton :to="managerOrigin" color="neutral" variant="outline" external>
              Open Bench Manager
            </UButton>
          </div>
        </template>
      </UCard>

      <UEmpty
        v-else
        title="Unknown Bench project"
        description="This hostname is not configured as a route for any project."
      >
        <template #leading>
          <UBadge color="neutral" variant="subtle">
            404
          </UBadge>
        </template>
        <template #actions>
          <UButton :to="managerOrigin" color="neutral" variant="outline" external>
            Open Bench Manager
          </UButton>
        </template>
      </UEmpty>
    </UContainer>
  </div>
</template>
