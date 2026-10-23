// Probe switches. A probe that is off is left out of command output, the
// probe log, and the scrape. Missing config keys stay on, so an older
// config file keeps today's behavior. Collectors that the platform always
// needs for a rate can still run; the omitted fields are not returned.

import type { ProcessInfo, SystemStats } from './types.ts'

export const PROBE_NAMES = [
  'cpu',
  'memory',
  'disk',
  'network',
  'host',
  'processes',
  'power',
  'gpu',
  'sensors',
  'pressure',
  'battery',
  'swap',
  'connections',
  'listen',
  'hardware',
  'proc',
] as const

export type ProbeName = (typeof PROBE_NAMES)[number]

export type ProbeSet = Record<ProbeName, boolean>

/** Probes whose fields are NOT NULL in system_samples. record refuses when one is off. */
export const RECORD_PROBES = ['cpu', 'memory', 'disk', 'network', 'host'] as const satisfies readonly ProbeName[]

export interface CollectFlags {
  sensors: boolean
  power: boolean
  gpu: boolean
  battery: boolean
  swap: boolean
  pressure: boolean
  diskDevices: boolean
}

const SYSTEM_KEYS: Record<ProbeName, (keyof SystemStats)[]> = {
  cpu: ['cpu_brand', 'cpu_usage_per_core', 'cpu_usage_total', 'core_count', 'cpu_core_kinds'],
  memory: [
    'memory_total',
    'memory_used',
    'memory_free',
    'memory_wired_bytes',
    'memory_compressed_bytes',
    'memory_app_bytes',
    'memory_cached_bytes',
    'pageins_per_s',
    'pageouts_per_s',
    'compressions_per_s',
    'decompressions_per_s',
  ],
  disk: ['disk_total_bytes', 'disk_used_bytes', 'disk_free_bytes', 'disk_devices'],
  network: ['network_rx_bytes', 'network_tx_bytes'],
  host: ['uptime_secs', 'load_avg', 'hostname', 'os_version', 'kernel_version', 'process_count'],
  processes: [],
  power: ['cpu_power_watts', 'gpu_power_watts', 'ane_power_watts', 'dram_power_watts'],
  gpu: [
    'gpu_utilization_percent',
    'gpu_renderer_utilization_percent',
    'gpu_tiler_utilization_percent',
    'gpu_memory_bytes',
  ],
  sensors: ['temperatures', 'fans', 'thermal_state'],
  pressure: ['psi_cpu_some_avg10', 'psi_io_some_avg10', 'psi_memory_some_avg10', 'memory_pressure_level'],
  battery: ['battery_charge_percent', 'battery_charging'],
  swap: ['swap_total_bytes', 'swap_used_bytes'],
  connections: [],
  listen: [],
  hardware: [],
  proc: [],
}

export function defaultProbes(): ProbeSet {
  return Object.fromEntries(PROBE_NAMES.map((name) => [name, true])) as ProbeSet
}

export function isProbeName(value: string): value is ProbeName {
  return (PROBE_NAMES as readonly string[]).includes(value)
}

/** Unknown names are returned separately. Blank pieces are ignored. */
export function parseProbeList(text: string): { names: ProbeName[]; unknown: string[] } {
  const names: ProbeName[] = []
  const unknown: string[] = []
  for (const part of text.split(',')) {
    const name = part.trim()
    if (!name) continue
    if (isProbeName(name)) names.push(name)
    else unknown.push(name)
  }
  return { names, unknown }
}

export function parseProbes(raw: unknown): ProbeSet {
  const probes = defaultProbes()
  if (!raw || typeof raw !== 'object') return probes
  const record = raw as Record<string, unknown>
  for (const name of PROBE_NAMES) {
    if (typeof record[name] === 'boolean') probes[name] = record[name]
  }
  return probes
}

export function disabledRecordProbes(probes: ProbeSet): ProbeName[] {
  return RECORD_PROBES.filter((name) => !probes[name])
}

/** Undefined flags mean every optional collector runs. An explicit false skips that collector. */
export function collectFlags(probes: ProbeSet): CollectFlags {
  return {
    sensors: probes.sensors,
    power: probes.power,
    gpu: probes.gpu,
    battery: probes.battery,
    swap: probes.swap,
    pressure: probes.pressure,
    diskDevices: probes.disk,
  }
}

export function flagOn(flags: CollectFlags | undefined, key: keyof CollectFlags): boolean {
  return flags?.[key] !== false
}

export function projectSystem(system: SystemStats, probes: ProbeSet): SystemStats {
  const out: SystemStats = { ...system }
  for (const name of PROBE_NAMES) {
    if (probes[name]) continue
    for (const key of SYSTEM_KEYS[name]) delete out[key]
  }
  return out
}

export function projectProcesses(rows: ProcessInfo[], probes: ProbeSet): ProcessInfo[] {
  if (!probes.processes) return []
  if (probes.gpu) return rows
  return rows.map((row) => {
    if (row.gpu_time_ms === undefined) return row
    const { gpu_time_ms: _omitted, ...rest } = row
    return rest
  })
}

export interface ProbeLogEntry {
  at: string
  probe: ProbeName
  [key: string]: string | number | boolean | null | undefined | unknown
}

/** One JSON object per enabled probe. Process command lines are not copied. */
export function probeEntries(
  system: SystemStats,
  processes: ProcessInfo[],
  probes: ProbeSet,
  at = new Date().toISOString(),
): ProbeLogEntry[] {
  const entries: ProbeLogEntry[] = []
  const push = (probe: ProbeName, fields: Record<string, unknown>) => {
    if (!probes[probe]) return
    entries.push({ at, probe, ...fields })
  }
  push('cpu', {
    cpu_usage_total: system.cpu_usage_total ?? null,
    core_count: system.core_count ?? null,
    cpu_usage_per_core: system.cpu_usage_per_core ?? null,
    cpu_core_kinds: system.cpu_core_kinds ?? null,
  })
  push('memory', {
    memory_used: system.memory_used ?? null,
    memory_total: system.memory_total ?? null,
    memory_wired_bytes: system.memory_wired_bytes ?? null,
    memory_compressed_bytes: system.memory_compressed_bytes ?? null,
    memory_app_bytes: system.memory_app_bytes ?? null,
    memory_cached_bytes: system.memory_cached_bytes ?? null,
    pageins_per_s: system.pageins_per_s ?? null,
    pageouts_per_s: system.pageouts_per_s ?? null,
    compressions_per_s: system.compressions_per_s ?? null,
    decompressions_per_s: system.decompressions_per_s ?? null,
  })
  push('disk', {
    disk_used_bytes: system.disk_used_bytes ?? null,
    devices: (system.disk_devices ?? []).map((device) => ({
      name: device.name,
      read_bytes_per_s: device.read_bytes_per_s,
      write_bytes_per_s: device.write_bytes_per_s,
    })),
  })
  push('network', {
    network_rx_bytes: system.network_rx_bytes ?? null,
    network_tx_bytes: system.network_tx_bytes ?? null,
  })
  push('host', {
    load_1: system.load_avg?.[0] ?? null,
    uptime_secs: system.uptime_secs ?? null,
    process_count: system.process_count ?? null,
    hostname: system.hostname ?? null,
  })
  push('processes', processSummary(processes))
  push('power', {
    cpu_power_watts: system.cpu_power_watts ?? null,
    gpu_power_watts: system.gpu_power_watts ?? null,
    ane_power_watts: system.ane_power_watts ?? null,
    dram_power_watts: system.dram_power_watts ?? null,
  })
  push('gpu', {
    gpu_utilization_percent: system.gpu_utilization_percent ?? null,
    gpu_memory_bytes: system.gpu_memory_bytes ?? null,
  })
  push('sensors', {
    thermal_state: system.thermal_state ?? null,
    temperatures: system.temperatures ?? [],
    fans: system.fans ?? [],
  })
  push('pressure', {
    psi_cpu_some_avg10: system.psi_cpu_some_avg10 ?? null,
    psi_io_some_avg10: system.psi_io_some_avg10 ?? null,
    psi_memory_some_avg10: system.psi_memory_some_avg10 ?? null,
    memory_pressure_level: system.memory_pressure_level ?? null,
  })
  push('battery', {
    battery_charge_percent: system.battery_charge_percent ?? null,
    battery_charging: system.battery_charging ?? null,
  })
  push('swap', {
    swap_total_bytes: system.swap_total_bytes ?? null,
    swap_used_bytes: system.swap_used_bytes ?? null,
  })
  return entries
}

function processSummary(processes: ProcessInfo[]): Record<string, number> {
  let rss = 0
  let owning = 0
  let wakeups = 0
  let gpuTime = 0
  let withGpu = 0
  for (const row of processes) {
    rss += row.memory_bytes
    if (row.owning_app) owning++
    if (row.idle_wakeups_per_s !== undefined) wakeups++
    if (row.gpu_time_ms !== undefined) {
      withGpu++
      gpuTime += row.gpu_time_ms
    }
  }
  return {
    count: processes.length,
    rss_bytes: Math.round(rss),
    with_owning_app: owning,
    with_idle_wakeups: wakeups,
    with_gpu_time: withGpu,
    gpu_time_ms: Math.round(gpuTime),
  }
}

export function countEntry(probe: 'connections' | 'listen', count: number, at = new Date().toISOString()): ProbeLogEntry {
  return { at, probe, count }
}

export function hardwareEntry(
  report: { logical_cores?: number; memory_bytes?: number; displays: unknown[]; from_cache?: boolean; chip?: string },
  at = new Date().toISOString(),
): ProbeLogEntry {
  return {
    at,
    probe: 'hardware',
    chip: report.chip ?? null,
    logical_cores: report.logical_cores ?? null,
    memory_bytes: report.memory_bytes ?? null,
    displays: report.displays.length,
    from_cache: report.from_cache === true,
  }
}

/** Detail log for one process. The cwd path and the environment are not included. */
export function procEntry(
  fields: { pid: number; children: number; hasCwd: boolean; fileCount: number | null },
  at = new Date().toISOString(),
): ProbeLogEntry {
  return {
    at,
    probe: 'proc',
    pid: fields.pid,
    children: fields.children,
    has_cwd: fields.hasCwd,
    file_count: fields.fileCount,
  }
}
