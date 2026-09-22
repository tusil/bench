<script setup lang="ts">
import type {
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

async function refreshDashboard(): Promise<void> {
  dashboardRefreshing.value = true;
  try {
    await Promise.all([refresh(), refreshResources({ dedupe: "defer" })]);
  } finally {
    dashboardRefreshing.value = false;
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
            :disabled="Boolean(activeProject)"
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

      <UPageGrid v-else class="mt-8">
        <UCard
          v-for="project in data?.projects"
          :key="project.id"
          class="flex flex-col"
          :ui="{ body: 'flex-1' }"
        >
          <template #header>
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <h2 class="truncate font-semibold">
                  {{ project.name || project.id }}
                </h2>
                <p v-if="project.name && project.name !== project.id" class="truncate text-xs text-muted">
                  {{ project.id }}
                </p>
              </div>
              <UBadge :color="statePresentation[project.state].color" variant="subtle">
                {{ statePresentation[project.state].label }}
              </UBadge>
            </div>
          </template>

          <ul v-if="project.routes.length" class="space-y-2">
            <li v-for="route in project.routes" :key="route">
              <ULink
                :to="route"
                external
                target="_blank"
                class="break-all text-sm"
              >
                {{ route }}
              </ULink>
            </li>
          </ul>
          <p v-else class="text-sm text-muted">
            No valid routes.
          </p>
          <UAlert
            v-if="project.error"
            class="mt-4"
            color="warning"
            variant="subtle"
            title="Project state is inconsistent"
            :description="project.error"
          />
          <dl class="mt-5 grid grid-cols-2 gap-4 border-t border-default pt-4">
            <div>
              <dt class="text-xs text-muted">
                CPU
              </dt>
              <dd class="mt-1 text-sm font-medium">
                {{ projectCpu(project.id) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                RAM
              </dt>
              <dd class="mt-1 text-sm font-medium">
                {{ projectMemory(project.id) }}
              </dd>
            </div>
          </dl>

          <template #footer>
            <div class="flex flex-wrap gap-2">
              <UButton
                :to="`/projects/${encodeURIComponent(project.id)}`"
              >
                View
              </UButton>
            </div>
          </template>
        </UCard>
      </UPageGrid>
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
