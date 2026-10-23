// Pure sensor, core-kind, and bundle-name decisions. Live readers stay in
// the platform collectors. A value outside the accepted range is omitted
// rather than relabeled.

import type { CpuCoreKind, FanReading, TemperatureReading, ThermalState } from './types.ts'

/** Public HID usage tables. Consumer-page fan speed is a linear control, not a tachometer. */
export const HID_PAGE_SENSOR = 0x20
export const HID_PAGE_POWER_DEVICE = 0x84
export const HID_USAGE_ENV_TEMPERATURE = 0x33
export const HID_USAGE_DATA_ENV_TEMPERATURE = 0x0434
export const HID_USAGE_PD_TEMPERATURE = 0x36

const CELSIUS_MIN = -40
const CELSIUS_MAX = 150

export function acceptsTemperatureElement(usagePage: number, usage: number): boolean {
  if (
    usagePage === HID_PAGE_SENSOR &&
    (usage === HID_USAGE_ENV_TEMPERATURE || usage === HID_USAGE_DATA_ENV_TEMPERATURE)
  ) {
    return true
  }
  return usagePage === HID_PAGE_POWER_DEVICE && usage === HID_USAGE_PD_TEMPERATURE
}

/**
 * Physical scale wins when it is in range. A physical 0 beside a different
 * in-range logical value means the scale was not applied. Both 0 stays 0.
 * Kelvin and millidegree values fall outside the range and are omitted.
 */
export function celsiusReading(
  physical: number | undefined,
  logical: number | undefined,
): number | undefined {
  const inRange = (n: number | undefined): n is number =>
    n !== undefined && Number.isFinite(n) && n >= CELSIUS_MIN && n <= CELSIUS_MAX
  if (physical === 0 && logical !== undefined && logical !== 0) {
    return inRange(logical) ? round3(logical) : undefined
  }
  if (inRange(physical)) return round3(physical)
  if (inRange(logical)) return round3(logical)
  return
}

export function thermalStateFromInt(value: number): ThermalState | undefined {
  switch (value) {
    case 0:
      return 'nominal'
    case 1:
      return 'fair'
    case 2:
      return 'serious'
    case 3:
      return 'critical'
    default:
      return
  }
}

export interface PerfLevelCount {
  level: number
  logicalCpu: number
  name?: string
}

/**
 * Kinds follow perflevel order, level 0 first. The result is omitted unless
 * the levels are contiguous from 0 and their logical CPUs sum to `cpuCount`,
 * which is the length of the core array they will label.
 */
export function coreKinds(levels: PerfLevelCount[], cpuCount: number): CpuCoreKind[] | undefined {
  if (levels.length === 0 || !Number.isInteger(cpuCount) || cpuCount <= 0) return
  const sorted = [...levels].sort((a, b) => a.level - b.level)
  if (sorted.some((level, index) => level.level !== index)) return
  if (sorted.some((level) => !Number.isInteger(level.logicalCpu) || level.logicalCpu <= 0)) return
  const sum = sorted.reduce((total, level) => total + level.logicalCpu, 0)
  if (sum !== cpuCount) return
  const kinds: CpuCoreKind[] = []
  for (const level of sorted) {
    const kind = kindFromName(level.name, level.level)
    for (let i = 0; i < level.logicalCpu; i++) kinds.push(kind)
  }
  return kinds
}

function kindFromName(name: string | undefined, level: number): CpuCoreKind {
  const normalized = name?.trim().toLowerCase()
  if (normalized === 'performance') return 'performance'
  if (normalized === 'efficiency') return 'efficiency'
  if (normalized) return 'unknown'
  if (level === 0) return 'performance'
  if (level === 1) return 'efficiency'
  return 'unknown'
}

/** Last `.app` path segment. Pass the executable path, not the argument vector. */
export function owningApp(executablePath: string): string | undefined {
  let found: string | undefined
  for (const part of executablePath.split('/')) {
    if (part.length > 4 && part.endsWith('.app')) found = part.slice(0, -4)
  }
  return found
}

export interface HwmonInput {
  chip: string
  /** `temp1_input` or `fan1_input`. */
  key: string
  input: string
  label?: string
}

/** `temp*_input` is millidegrees Celsius. `fan*_input` is rpm. A measured 0 stays 0. */
export function parseHwmonInput(
  row: HwmonInput,
): { kind: 'temp'; reading: TemperatureReading } | { kind: 'fan'; reading: FanReading } | null {
  const kind = row.key.match(/^(temp|fan)\d+_input$/)?.[1]
  if (!kind) return null
  const raw = row.input.trim()
  if (!/^-?\d+$/.test(raw)) return null
  const value = Number(raw)
  const label = row.label?.trim() || row.key.replace(/_input$/, '')
  const chip = row.chip.trim()
  const name = chip ? `${chip} ${label}` : label
  if (kind === 'temp') return { kind: 'temp', reading: { name, celsius: round3(value / 1000) } }
  if (value < 0) return null
  return { kind: 'fan', reading: { name, rpm: value } }
}

/** amdgpu `gpu_busy_percent`, 0–100. A measured 0 stays 0. */
export function parseGpuBusyPercent(text: string): number | null {
  const raw = text.trim()
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  if (n > 100) return null
  return n
}

/** `mem_info_vram_used` in bytes. */
export function parseGpuMemoryBytes(text: string): number | null {
  const raw = text.trim()
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isSafeInteger(n)) return null
  return n
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
