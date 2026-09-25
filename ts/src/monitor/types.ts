// Output shapes mirror the Go CLI's --json field names (cli/main.go) so
// existing jq pipelines keep working against the TypeScript port.

import type { EnergyNj } from './energy.ts'

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
  virtual_memory_bytes?: number
  /** bytes/s since last refresh (0 when the OS denies the counters) */
  disk_read_bytes: number
  disk_write_bytes: number
}

/** Expensive per-process fields fetched on demand (port of ProcessDetail) */
export interface ProcessDetail {
  cwd?: string
  environ?: string[]
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
  /**
   * Swap in bytes. Omitted when the platform has no reading — never a
   * stand-in zero. A measured total of 0 (swap disabled) is still stored.
   * TS-only until the Go monitor grows the same fields.
   */
  swap_total_bytes?: number
  swap_used_bytes?: number
  /**
   * Omitted when the machine has no battery. `battery_charging: false`
   * means a battery is present and not charging.
   */
  battery_charge_percent?: number
  battery_charging?: boolean
  /**
   * Linux PSI `some` avg10: percent of the last 10s in which at least one
   * task was stalled. Each resource is omitted when `/proc/pressure` has
   * no reading. A measured 0 is stored.
   */
  psi_cpu_some_avg10?: number
  psi_io_some_avg10?: number
  psi_memory_some_avg10?: number
  /**
   * macOS `kern.memorystatus_vm_pressure_level` as the userspace note,
   * not the internal 0–4 enum: 1 normal, 2 warning (also urgent), 4 critical.
   * Omitted on other platforms and on an unrecognized value.
   */
  memory_pressure_level?: MemoryPressureLevel
  /**
   * Apple Silicon package power between the last two refreshes.
   * Omitted when IOReport has no reading. A measured 0 is an idle rail.
   */
  cpu_power_watts?: number
  gpu_power_watts?: number
  ane_power_watts?: number
  dram_power_watts?: number
}

export type MemoryPressureLevel = 'normal' | 'warning' | 'critical'

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
  vsizeBytes?: number
  /** cumulative disk I/O byte counters; Monitor computes rates */
  diskReadTotal?: number
  diskWriteTotal?: number
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
  /** Bytes. Both set, or both absent. */
  swapTotal?: number
  swapUsed?: number
  /** Both set, or both absent. `batteryCharging` may be false. */
  batteryChargePercent?: number
  batteryCharging?: boolean
  /** Linux PSI `some` avg10. Each is independent. */
  psiCpuSomeAvg10?: number
  psiIoSomeAvg10?: number
  psiMemorySomeAvg10?: number
  /** macOS note: normal / warning / critical. */
  memoryPressureLevel?: MemoryPressureLevel
  /** Cumulative package energy in nanojoules. Monitor turns the delta into watts. */
  energyNj?: EnergyNj
}
