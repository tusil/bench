<script setup lang="ts">
import { useManagerResources } from "~/composables/useManagerResources";
import type { CapacityUsage } from "~~/shared/types/resources";
import { hostnameFromUrl } from "~~/shared/utils/projects";

interface StatusMetric {
  label: string;
  icon: string;
  value: string;
  detail: string;
  progress: number;
}

const config = useRuntimeConfig();
const requestUrl = useRequestURL();
const isManager = requestUrl.hostname.toLowerCase() === hostnameFromUrl(config.public.managerOrigin);
const {
  data: resources,
  error: resourcesError,
  refresh: refreshResources,
  status: resourcesStatus,
} = await useManagerResources(isManager);
const dashboardRefreshing = ref(false);
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

function capacityDetail(capacity: CapacityUsage): string {
  return `${formatBytes(capacity.usedBytes)} / ${formatBytes(capacity.totalBytes)}`;
}

const statusMetrics = computed<StatusMetric[]>(() => {
  if (!resources.value) {
    return [
      { label: "CPU", icon: "i-lucide-cpu", value: "Unavailable", detail: "CPU usage is unavailable.", progress: 0 },
      { label: "RAM", icon: "i-lucide-memory-stick", value: "Unavailable", detail: "Memory usage is unavailable.", progress: 0 },
      { label: "Swap", icon: "i-lucide-arrow-left-right", value: "Unavailable", detail: "Swap usage is unavailable.", progress: 0 },
      { label: "Disk", icon: "i-lucide-hard-drive", value: "Unavailable", detail: "Projects disk usage is unavailable.", progress: 0 },
    ];
  }

  const { cpu, memory, swap, disk } = resources.value.system;
  const swapConfigured = swap.totalBytes > 0;
  return [
    {
      label: "CPU",
      icon: "i-lucide-cpu",
      value: formatPercent(cpu.usagePercent),
      detail: `${cpu.logicalCores} logical cores`,
      progress: cpu.usagePercent,
    },
    {
      label: "RAM",
      icon: "i-lucide-memory-stick",
      value: formatPercent(capacityPercent(memory)),
      detail: capacityDetail(memory),
      progress: capacityPercent(memory),
    },
    {
      label: "Swap",
      icon: "i-lucide-arrow-left-right",
      value: swapConfigured ? formatPercent(capacityPercent(swap)) : "Off",
      detail: swapConfigured ? capacityDetail(swap) : "Swap is not configured.",
      progress: capacityPercent(swap),
    },
    {
      label: "Disk",
      icon: "i-lucide-hard-drive",
      value: formatPercent(capacityPercent(disk)),
      detail: capacityDetail(disk),
      progress: capacityPercent(disk),
    },
  ];
});

function responseError(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const response = value as { data?: { data?: { message?: string }; message?: string }; message?: string };
    return response.data?.data?.message || response.data?.message || response.message || "Resource usage is unavailable.";
  }
  return "Resource usage is unavailable.";
}

async function refreshDashboard(): Promise<void> {
  dashboardRefreshing.value = true;
  try {
    await refreshNuxtData();
  } finally {
    dashboardRefreshing.value = false;
  }
}

async function pollResources(): Promise<void> {
  if (!isManager || document.hidden || resourcesStatus.value === "pending") return;
  await refreshResources({ dedupe: "defer" });
}

function handleVisibilityChange(): void {
  if (!document.hidden) void pollResources();
}

let resourcesTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  if (!isManager) return;
  resourcesTimer = setInterval(() => void pollResources(), 5_000);
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onBeforeUnmount(() => {
  if (resourcesTimer) clearInterval(resourcesTimer);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});
</script>

<template>
  <UDashboardGroup v-if="isManager">
    <UDashboardPanel id="manager">
      <template #header>
        <UDashboardToolbar class="min-h-8 border-neutral-800 bg-neutral-950 px-2 text-white sm:px-3">
          <template #left>
            <div class="flex items-center gap-4">
              <USkeleton
                v-for="index in resourcesStatus === 'pending' && !resources ? 4 : 0"
                :key="index"
                class="h-4 w-28 shrink-0 bg-white/15"
              />

              <UTooltip
                v-for="metric in resourcesStatus === 'pending' && !resources ? [] : statusMetrics"
                :key="metric.label"
                :text="`${metric.label}: ${metric.detail}`"
              >
                <div
                  class="flex shrink-0 items-center gap-1.5"
                  :aria-label="`${metric.label}: ${metric.value}. ${metric.detail}`"
                >
                  <UIcon :name="metric.icon" class="size-3.5 shrink-0 text-neutral-300" />
                  <span class="text-[11px] text-neutral-400">{{ metric.label }}</span>
                  <span class="min-w-8 text-right text-xs font-medium text-white">{{ metric.value }}</span>
                  <UProgress
                    class="w-12 shrink-0"
                    size="2xs"
                    :model-value="metric.progress"
                    :ui="{ base: 'bg-white/20', indicator: 'bg-white' }"
                  />
                </div>
              </UTooltip>

              <UTooltip v-if="resourcesError" :text="responseError(resourcesError)">
                <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0 text-red-400" />
              </UTooltip>
            </div>
          </template>
        </UDashboardToolbar>

        <UDashboardNavbar :toggle="false">
          <template #title>
            <span class="font-mono">&lt;BENCH /&gt;</span>
          </template>

          <template #right>
            <UTooltip text="Refresh dashboard">
              <UButton
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="ghost"
                square
                :loading="dashboardRefreshing"
                aria-label="Refresh dashboard"
                @click="refreshDashboard"
              />
            </UTooltip>
            <UTooltip text="Toggle color mode">
              <UColorModeButton square />
            </UTooltip>
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>

  <slot v-else />
</template>
