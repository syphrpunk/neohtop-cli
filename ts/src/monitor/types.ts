// Output shapes mirror the Go CLI's --json field names (cli/main.go) so
// existing jq pipelines keep working against the TypeScript port.

export interface ProcessInfo {
  pid: number
  ppid: number
  name: string
  /** percentage, 0-100 per core */
  cpu_usage: number
  /** RSS in bytes */
  memory_bytes: number
  /** "Running" | "Sleeping" | "Idle" | "Stopped" | "Zombie" | "Waiting" | "Unknown" */
  status: string
  user: string
  command: string
  threads?: number
  runtime_secs: number
  /** bytes/s since last refresh (0 where the OS needs privileged APIs) */
  disk_read_bytes: number
  disk_write_bytes: number
}

export interface SystemStats {
  cpu_brand: string
  /** per-core percentages */
  cpu_usage_per_core: number[]
  cpu_usage_total: number
  core_count: number
  memory_total: number
  memory_used: number
  memory_free: number
  uptime_secs: number
  load_avg: [number, number, number]
  /** bytes/s since last refresh */
  network_rx_bytes: number
  network_tx_bytes: number
  disk_total_bytes: number
  disk_used_bytes: number
  disk_free_bytes: number
  hostname: string
  os_version: string
  kernel_version: string
  process_count: number
}

// ---- Internal platform-sample contract ----

/** Raw per-core tick counters (Linux) for delta-based CPU% */
export interface CoreTicks {
  busy: number
  total: number
}

export interface RawProc {
  pid: number
  ppid: number
  name: string
  memoryBytes: number
  status: string
  user: string
  command: string
  threads?: number
  runtimeSecs: number
  /** ready-made percentage (macOS: ps pcpu) */
  cpuPct?: number
  /** cumulative CPU ticks utime+stime (Linux) */
  cpuTicks?: number
}

export interface PlatformSample {
  cpuBrand: string
  coreCount: number
  /** raw tick counters per core (Linux /proc/stat, macOS os.cpus()); Monitor computes deltas */
  cpuPerCoreTicks?: CoreTicks[]
  memoryTotal: number
  memoryUsed: number
  memoryFree: number
  /** cumulative interface byte counters; Monitor computes rates */
  netRxTotal: number
  netTxTotal: number
  diskTotal: number
  diskUsed: number
  diskFree: number
  uptimeSecs: number
  loadAvg: [number, number, number]
  hostname: string
  osVersion: string
  kernelVersion: string
  procs: RawProc[]
}
