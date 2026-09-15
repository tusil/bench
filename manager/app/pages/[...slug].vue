<script setup lang="ts">
import type {
  ActionResponse,
  ProjectState,
  ProjectsResponse,
  StartOperationResponse,
} from "~~/shared/types/projects";
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
const routedProject = computed(() => data.value
  ? findProjectByHostname(data.value.projects, requestUrl.hostname)
  : undefined);

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

async function start(id: string) {
  activeProject.value = id;
  try {
    const result = await $fetch<StartOperationResponse>(`/api/projects/${encodeURIComponent(id)}/up`, {
      method: "POST",
      body: {},
    });
    const path = `/projects/${encodeURIComponent(id)}/logs?operation=${encodeURIComponent(result.operationId)}`;
    if (isDashboard) await navigateTo(path);
    else window.location.assign(new URL(path, managerOrigin).toString());
  } catch (cause) {
    toast.add({ title: "Could not start project", description: conciseError(cause), color: "error" });
  } finally {
    activeProject.value = undefined;
  }
}

async function stop(id: string) {
  activeProject.value = id;
  try {
    await $fetch<ActionResponse>(`/api/projects/${encodeURIComponent(id)}/down`, {
      method: "POST",
      body: {},
    });
    toast.add({ title: "Project stopped", color: "success" });
  } catch (cause) {
    toast.add({ title: "Could not stop project", description: conciseError(cause), color: "error" });
  } finally {
    if (isDashboard) await refresh();
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
            :loading="status === 'pending'"
            :disabled="Boolean(activeProject)"
            @click="refresh()"
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

          <template #footer>
            <div class="flex flex-wrap gap-2">
              <UButton
                :loading="activeProject === project.id"
                :disabled="Boolean(activeProject) || project.state === 'invalid' || project.state === 'running'"
                @click="start(project.id)"
              >
                Start
              </UButton>
              <UButton
                color="error"
                variant="soft"
                :loading="activeProject === project.id"
                :disabled="Boolean(activeProject) || project.state === 'invalid' || project.state === 'stopped'"
                @click="stop(project.id)"
              >
                Stop
              </UButton>
              <UButton
                v-if="project.state !== 'invalid'"
                :disabled="Boolean(activeProject)"
                :to="`/projects/${encodeURIComponent(project.id)}/logs`"
                color="neutral"
                variant="outline"
              >
                Logs
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
