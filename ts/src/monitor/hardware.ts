// On-demand hardware inventory. Never called from `record` or `service`.
// The cached file is the allowlisted report, not the raw profiler dump:
// serial numbers, UUIDs, and charger identity are not copied.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'
import { configDir, ensureConfigDir } from '../store/config.ts'

export class HardwareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HardwareError'
  }
}

export interface HardwareDisplay {
  name: string
  resolution?: string
  main?: boolean
}

export interface HardwareBattery {
  health?: string
  maximum_capacity_percent?: number
  cycle_count?: number
}

export interface HardwareReport {
  collected_at: string
  chip?: string
  model?: string
  model_id?: string
  logical_cores?: number
  performance_cores?: number
  efficiency_cores?: number
  gpu_cores?: number
  memory_bytes?: number
  displays: HardwareDisplay[]
  battery?: HardwareBattery
  /** Set when the report was read from disk. Not written back. */
  from_cache?: boolean
}

export function hardwareCachePath(): string {
  return join(configDir(), 'hardware.json')
}

/** Drop anything that is not part of the inventory. A bad cache returns null. */
export function normalizeHardware(value: unknown): HardwareReport | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw['collected_at'] !== 'string' || raw['collected_at'] === '') return null
  const report: HardwareReport = {
    collected_at: raw['collected_at'],
    displays: [],
  }
  const str = (key: 'chip' | 'model' | 'model_id') => {
    const v = raw[key]
    if (typeof v === 'string' && v.trim() !== '') report[key] = v.trim()
  }
  str('chip')
  str('model')
  str('model_id')
  const num = (key: 'logical_cores' | 'performance_cores' | 'efficiency_cores' | 'gpu_cores' | 'memory_bytes') => {
    const v = raw[key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) report[key] = Math.round(v)
  }
  num('logical_cores')
  num('performance_cores')
  num('efficiency_cores')
  num('gpu_cores')
  num('memory_bytes')
  if (Array.isArray(raw['displays'])) {
    for (const item of raw['displays']) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      if (typeof row['name'] !== 'string' || row['name'].trim() === '') continue
      const display: HardwareDisplay = { name: row['name'].trim() }
      if (typeof row['resolution'] === 'string' && row['resolution'].trim() !== '') {
        display.resolution = row['resolution'].trim()
      }
      if (row['main'] === true) display.main = true
      report.displays.push(display)
    }
  }
  if (raw['battery'] && typeof raw['battery'] === 'object') {
    const b = raw['battery'] as Record<string, unknown>
    const battery: HardwareBattery = {}
    if (typeof b['health'] === 'string' && b['health'].trim() !== '') battery.health = b['health'].trim()
    if (typeof b['maximum_capacity_percent'] === 'number' && Number.isFinite(b['maximum_capacity_percent'])) {
      battery.maximum_capacity_percent = Math.round(b['maximum_capacity_percent'])
    }
    if (typeof b['cycle_count'] === 'number' && Number.isFinite(b['cycle_count']) && b['cycle_count'] >= 0) {
      battery.cycle_count = Math.round(b['cycle_count'])
    }
    if (Object.keys(battery).length > 0) report.battery = battery
  }
  return report
}

/**
 * `system_profiler -json` for hardware, displays, and power.
 * `memoryBytes` is `hw.memsize` when the caller has it; the "16 GB" label is the fallback.
 */
export function parseDarwinHardware(
  raw: unknown,
  opts: { memoryBytes?: number; collectedAt: string },
): HardwareReport {
  if (!raw || typeof raw !== 'object') throw new HardwareError('system_profiler returned no inventory')
  const doc = raw as Record<string, unknown>
  const hw = firstObj(doc['SPHardwareDataType'])
  const displayRoot = firstObj(doc['SPDisplaysDataType'])
  const built: Record<string, unknown> = { collected_at: opts.collectedAt, displays: [] }
  if (hw) {
    if (typeof hw['chip_type'] === 'string') built['chip'] = hw['chip_type']
    if (typeof hw['machine_name'] === 'string') built['model'] = hw['machine_name']
    if (typeof hw['machine_model'] === 'string') built['model_id'] = hw['machine_model']
    const cores = typeof hw['number_processors'] === 'string' ? hw['number_processors'] : ''
    const layout = cores.match(/^proc (\d+):(\d+):(\d+):\d+$/)
    if (layout) {
      built['logical_cores'] = Number(layout[1])
      built['performance_cores'] = Number(layout[2])
      built['efficiency_cores'] = Number(layout[3])
    }
    if (opts.memoryBytes !== undefined && Number.isFinite(opts.memoryBytes)) {
      built['memory_bytes'] = opts.memoryBytes
    } else if (typeof hw['physical_memory'] === 'string') {
      const bytes = parseMemoryLabel(hw['physical_memory'])
      if (bytes !== undefined) built['memory_bytes'] = bytes
    }
  }
  if (displayRoot) {
    const gpu = Number(displayRoot['sppci_cores'])
    if (Number.isFinite(gpu) && gpu >= 0) built['gpu_cores'] = gpu
    const ndrvs = displayRoot['spdisplays_ndrvs']
    if (Array.isArray(ndrvs)) {
      built['displays'] = ndrvs.map((item) => {
        if (!item || typeof item !== 'object') return null
        const row = item as Record<string, unknown>
        return {
          name: row['_name'],
          resolution: row['_spdisplays_resolution'],
          main: row['spdisplays_main'] === 'spdisplays_yes',
        }
      })
    }
  }
  const power = arrayOf(doc['SPPowerDataType']).find((item) => item['_name'] === 'spbattery_information')
  const health = power?.['sppower_battery_health_info']
  if (health && typeof health === 'object') {
    const info = health as Record<string, unknown>
    const capacity =
      typeof info['sppower_battery_health_maximum_capacity'] === 'string'
        ? info['sppower_battery_health_maximum_capacity'].match(/(\d+(?:\.\d+)?)\s*%/)
        : null
    built['battery'] = {
      health: info['sppower_battery_health'],
      maximum_capacity_percent: capacity ? Number(capacity[1]) : undefined,
      cycle_count: info['sppower_battery_cycle_count'],
    }
  }
  const report = normalizeHardware(built)
  if (!report) throw new HardwareError('system_profiler returned no inventory')
  return report
}

export function parseLinuxHardware(input: {
  cpuinfo: string
  meminfo: string
  displays?: { name?: string; resolution?: string; connected?: boolean }[]
  battery?: { cycleCount?: string; energyFull?: string; energyFullDesign?: string }
  collectedAt: string
}): HardwareReport {
  const chip =
    input.cpuinfo.match(/^model name\s*:\s*(.+)$/m)?.[1]?.trim() ??
    input.cpuinfo.match(/^Hardware\s*:\s*(.+)$/m)?.[1]?.trim()
  const logical = input.cpuinfo.match(/^processor\s*:/gm)?.length
  const mem = input.meminfo.match(/^MemTotal:\s+(\d+)\s+kB/m)
  const displays = (input.displays ?? [])
    .filter((d) => d.connected !== false && typeof d.name === 'string' && d.name !== '')
    .map((d) => ({ name: d.name, resolution: d.resolution }))
  const built: Record<string, unknown> = {
    collected_at: input.collectedAt,
    ...(chip ? { chip } : {}),
    ...(logical ? { logical_cores: logical } : {}),
    ...(mem ? { memory_bytes: Number(mem[1]) * 1024 } : {}),
    displays,
  }
  const battery = linuxBattery(input.battery)
  if (battery) built['battery'] = battery
  const report = normalizeHardware(built)
  if (!report) throw new HardwareError('linux inventory had no timestamp')
  return report
}

export function parseWindowsHardware(
  raw: {
    model?: string
    cpu?: string
    logicalCores?: number
    memoryBytes?: number
    gpuCores?: number
    displays?: { name?: string; resolution?: string }[]
    battery?: { health?: string; fullCharge?: number; designCapacity?: number; cycleCount?: number }
  },
  collectedAt: string,
): HardwareReport {
  let maximum: number | undefined
  const full = raw.battery?.fullCharge
  const design = raw.battery?.designCapacity
  if (full !== undefined && design !== undefined && design > 0) {
    maximum = Math.round((full / design) * 100)
  }
  const built: Record<string, unknown> = {
    collected_at: collectedAt,
    model: raw.model,
    chip: raw.cpu,
    logical_cores: raw.logicalCores,
    memory_bytes: raw.memoryBytes,
    gpu_cores: raw.gpuCores,
    displays: raw.displays ?? [],
    ...(raw.battery
      ? {
          battery: {
            health: raw.battery.health,
            maximum_capacity_percent: maximum,
            cycle_count: raw.battery.cycleCount,
          },
        }
      : {}),
  }
  const report = normalizeHardware(built)
  if (!report) throw new HardwareError('windows inventory had no timestamp')
  return report
}

export function readHardwareCache(path: string): HardwareReport | null {
  try {
    const report = normalizeHardware(JSON.parse(readFileSync(path, 'utf8')))
    return report ? { ...report, from_cache: true } : null
  } catch {
    return null
  }
}

export function writeHardwareCache(path: string, report: HardwareReport): void {
  const stored = { ...report }
  delete stored.from_cache
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`)
}

/** Cached inventory, or a fresh read when `refresh` is set or the cache is missing. */
export function hardwareInventory(opts: { refresh?: boolean; cachePath?: string } = {}): HardwareReport {
  const path = opts.cachePath ?? hardwareCachePath()
  if (!opts.refresh) {
    const cached = readHardwareCache(path)
    if (cached) return cached
  }
  const report = collectHardware()
  try {
    if (path !== ':memory:') {
      ensureConfigDir()
      writeHardwareCache(path, report)
    }
  } catch {
    // The reading is still returned when the cache directory is not writable.
  }
  return report
}

function collectHardware(): HardwareReport {
  const collectedAt = new Date().toISOString()
  switch (platform()) {
    case 'darwin':
      return collectDarwin(collectedAt)
    case 'linux':
      return collectLinux(collectedAt)
    case 'win32':
      return collectWindows(collectedAt)
    default:
      throw new HardwareError(`unsupported platform: ${platform()}`)
  }
}

function collectDarwin(collectedAt: string): HardwareReport {
  try {
    const text = execFileSync(
      '/usr/sbin/system_profiler',
      ['SPHardwareDataType', 'SPDisplaysDataType', 'SPPowerDataType', '-json'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )
    const mem = Number(
      execFileSync('/usr/sbin/sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' }).trim(),
    )
    return parseDarwinHardware(JSON.parse(text), {
      collectedAt,
      ...(Number.isFinite(mem) ? { memoryBytes: mem } : {}),
    })
  } catch (err) {
    if (err instanceof HardwareError) throw err
    throw new HardwareError('system_profiler failed')
  }
}

function collectLinux(collectedAt: string): HardwareReport {
  try {
    return parseLinuxHardware({
      cpuinfo: readFileSync('/proc/cpuinfo', 'utf8'),
      meminfo: readFileSync('/proc/meminfo', 'utf8'),
      displays: linuxDisplays(),
      battery: linuxBatteryFiles(),
      collectedAt,
    })
  } catch (err) {
    if (err instanceof HardwareError) throw err
    throw new HardwareError('linux inventory failed')
  }
}

function collectWindows(collectedAt: string): HardwareReport {
  const script = `
$ErrorActionPreference = 'Stop'
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$videos = @(Get-CimInstance Win32_VideoController | Select-Object Name,CurrentHorizontalResolution,CurrentVerticalResolution)
$bats = @(Get-CimInstance Win32_Battery | Select-Object -First 1 DesignCapacity,FullChargeCapacity)
@{
  model = $cs.Model
  cpu = $cpu.Name
  logicalCores = [int]$cs.NumberOfLogicalProcessors
  memoryBytes = [int64]$cs.TotalPhysicalMemory
  displays = @($videos | ForEach-Object { @{ name = $_.Name; resolution = if ($_.CurrentHorizontalResolution) { "$($_.CurrentHorizontalResolution) x $($_.CurrentVerticalResolution)" } else { $null } } })
  battery = if ($bats.Count -gt 0) { @{ fullCharge = $bats[0].FullChargeCapacity; designCapacity = $bats[0].DesignCapacity } } else { $null }
} | ConvertTo-Json -Depth 4 -Compress
`
  try {
    const text = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    )
    const raw = JSON.parse(text) as {
      model?: string
      cpu?: string
      logicalCores?: number
      memoryBytes?: number
      displays?: { name?: string; resolution?: string | null }[]
      battery?: { fullCharge?: number; designCapacity?: number } | null
    }
    return parseWindowsHardware(
      {
        model: raw.model,
        cpu: raw.cpu,
        logicalCores: raw.logicalCores,
        memoryBytes: raw.memoryBytes,
        displays: (raw.displays ?? []).map((d) => ({
          name: d.name,
          ...(d.resolution ? { resolution: d.resolution } : {}),
        })),
        ...(raw.battery ? { battery: raw.battery } : {}),
      },
      collectedAt,
    )
  } catch (err) {
    if (err instanceof HardwareError) throw err
    throw new HardwareError('windows inventory failed')
  }
}

function linuxDisplays(): { name: string; resolution?: string; connected: boolean }[] {
  const dir = '/sys/class/drm'
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (!/^card\d+-/.test(name)) continue
    let status = ''
    try {
      status = readFileSync(join(dir, name, 'status'), 'utf8').trim()
    } catch {
      continue
    }
    let resolution: string | undefined
    try {
      const mode = readFileSync(join(dir, name, 'modes'), 'utf8').split('\n')[0]?.trim()
      if (mode) resolution = mode
    } catch {
      // connector has no modes file
    }
    out.push({ name, resolution, connected: status === 'connected' })
  }
  return out
}

function linuxBatteryFiles(): { cycleCount?: string; energyFull?: string; energyFullDesign?: string } | undefined {
  const dir = '/sys/class/power_supply'
  if (!existsSync(dir)) return
  const bat = readdirSync(dir)
    .filter((n) => /^BAT\d+$/.test(n))
    .sort()[0]
  if (!bat) return
  const read = (file: string) => {
    try {
      return readFileSync(join(dir, bat, file), 'utf8')
    } catch {
      return
    }
  }
  return {
    cycleCount: read('cycle_count'),
    energyFull: read('energy_full'),
    energyFullDesign: read('energy_full_design'),
  }
}

function linuxBattery(
  files: { cycleCount?: string; energyFull?: string; energyFullDesign?: string } | undefined,
): HardwareBattery | undefined {
  if (!files) return
  const battery: HardwareBattery = {}
  const cycles = Number(files.cycleCount?.trim())
  if (Number.isFinite(cycles) && cycles >= 0 && files.cycleCount !== undefined) battery.cycle_count = Math.round(cycles)
  const full = Number(files.energyFull?.trim())
  const design = Number(files.energyFullDesign?.trim())
  if (Number.isFinite(full) && Number.isFinite(design) && design > 0) {
    battery.maximum_capacity_percent = Math.round((full / design) * 100)
  }
  return Object.keys(battery).length > 0 ? battery : undefined
}

/** system_profiler memory labels are decimal (16 GB = 16×1000³). */
function parseMemoryLabel(text: string): number | undefined {
  const m = text.trim().match(/^([\d.]+)\s*(KB|MB|GB|TB)$/i)
  if (!m) return
  const n = Number(m[1])
  if (!Number.isFinite(n)) return
  const scale: Record<string, number> = { KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3, TB: 1000 ** 4 }
  return Math.round(n * scale[m[2]!.toUpperCase()]!)
}

function firstObj(value: unknown): Record<string, unknown> | undefined {
  const row = arrayOf(value)[0]
  return row
}

function arrayOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
}
