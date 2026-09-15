export interface CapacityUsage {
  usedBytes: number;
  totalBytes: number;
}

export interface SystemResourceUsage {
  cpu: {
    usagePercent: number;
    logicalCores: number;
  };
  memory: CapacityUsage;
  swap: CapacityUsage;
  disk: CapacityUsage;
}

export type ProjectResourceUsage =
  | {
      id: string;
      available: true;
      cpuPercent: number;
      memoryUsedBytes: number;
      containerCount: number;
    }
  | {
      id: string;
      available: false;
    };

export interface ResourcesResponse {
  sampledAt: string;
  system: SystemResourceUsage;
  projects: ProjectResourceUsage[];
}
