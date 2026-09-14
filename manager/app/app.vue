<script setup lang="ts">
import type {
  ActionResponse,
  ProjectState,
  ProjectsResponse,
} from "~~/shared/types/projects";

const toast = useToast();
const activeProject = ref<string>();
const { data, error, refresh, status } = await useFetch<ProjectsResponse>("/api/projects");

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

async function run(id: string, action: "up" | "down") {
  activeProject.value = id;
  try {
    const result = await $fetch<ActionResponse>(`/api/projects/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: {},
    });
    toast.add({ title: result.message, color: "success" });
  } catch (cause) {
    toast.add({ title: "Operation failed", description: responseError(cause), color: "error" });
  } finally {
    await refresh();
    activeProject.value = undefined;
  }
}
</script>

<template>
  <UApp>
    <main class="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-10 sm:px-6 lg:px-8">
      <header class="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
            Youngmedia
          </p>
          <h1 class="text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
            Bench
          </h1>
          <p class="mt-2 text-sm text-muted">
            Projects available on this development server.
          </p>
        </div>
        <UButton
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          :disabled="Boolean(activeProject)"
          @click="refresh()"
        >
          Refresh
        </UButton>
      </header>

      <UAlert
        v-if="error"
        class="mb-6"
        color="error"
        variant="subtle"
        title="Could not load projects"
        :description="responseError(error)"
      />

      <div v-if="status === 'pending' && !data" class="grid gap-4 md:grid-cols-2">
        <USkeleton v-for="index in 4" :key="index" class="h-56 rounded-xl" />
      </div>

      <UCard
        v-else-if="data?.projects.length === 0"
        class="py-12 text-center"
        variant="subtle"
      >
        <h2 class="text-lg font-medium text-highlighted">
          No Bench projects found
        </h2>
        <p class="mt-2 text-sm text-muted">
          Add a bench.yml file to a direct subdirectory of the configured projects directory.
        </p>
      </UCard>

      <section v-else class="grid gap-4 md:grid-cols-2">
        <UCard
          v-for="project in data?.projects"
          :key="project.id"
          variant="subtle"
          :ui="{ body: 'flex h-full flex-col' }"
        >
          <div class="mb-5 flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2 class="truncate text-lg font-semibold text-highlighted">
                {{ project.name || project.id }}
              </h2>
              <p v-if="project.name && project.name !== project.id" class="truncate text-xs text-dimmed">
                {{ project.id }}
              </p>
            </div>
            <UBadge :color="statePresentation[project.state].color" variant="subtle">
              {{ statePresentation[project.state].label }}
            </UBadge>
          </div>

          <div class="mb-6 min-h-16 flex-1">
            <ul v-if="project.routes.length" class="space-y-2">
              <li v-for="route in project.routes" :key="route">
                <a
                  :href="route"
                  target="_blank"
                  rel="noreferrer"
                  class="break-all text-sm text-primary hover:underline"
                >
                  {{ route }}
                </a>
              </li>
            </ul>
            <p v-else class="text-sm text-muted">
              No valid routes.
            </p>
            <p v-if="project.error" class="mt-3 text-sm text-error">
              {{ project.error }}
            </p>
          </div>

          <div class="flex gap-2 border-t border-default pt-4">
            <UButton
              :loading="activeProject === project.id"
              :disabled="Boolean(activeProject) || project.state === 'invalid' || project.state === 'running'"
              @click="run(project.id, 'up')"
            >
              Start
            </UButton>
            <UButton
              color="error"
              variant="soft"
              :loading="activeProject === project.id"
              :disabled="Boolean(activeProject) || project.state === 'invalid' || project.state === 'stopped'"
              @click="run(project.id, 'down')"
            >
              Stop
            </UButton>
          </div>
        </UCard>
      </section>
    </main>
  </UApp>
</template>
