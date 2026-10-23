// Persistent user config. State lives under ~/.config/sloppytop/
// (XDG_CONFIG_HOME respected): config.json, the metrics SQLite DB, and the
// recorder log. An existing ~/.config/neohtop directory is kept so a rename
// does not orphan recorded samples.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultProbes, parseProbes, type ProbeName, type ProbeSet } from '../monitor/probes.ts'
import { isThemeName } from '../tui/theme.ts'

export interface MetricsConfig {
  /** When false, `metrics serve` does not bind. */
  enabled: boolean
  /** Bind address. Defaults to loopback. */
  host: string
  port: number
}

export interface Config {
  record: {
    /** top-N processes (by CPU) stored per sample */
    processLimit: number
    /** samples older than this are pruned on each record run */
    retentionDays: number
    /** delta-sampling window for CPU/network rates */
    sampleMs: number
  }
  /** Name or command patterns floated by `top` and `processes`. */
  pins: string[]
  /** Name or command patterns rolled up together in `report`. */
  groups: ProcessGroup[]
  /** Each monitoring probe. Missing keys stay on. */
  probes: ProbeSet
  /** Prometheus scrape listener. Off until enabled. */
  metrics: MetricsConfig
  /** Screen preferences. Missing keys stay at the Go screen defaults. */
  tui: TuiConfig
}

/** Columns the screen knows how to draw. The first seven match the Go default set. */
export const TUI_COLUMNS = [
  'pid',
  'name',
  'command',
  'threads',
  'user',
  'memory',
  'cpu',
  'status',
  'runtime',
  'disk',
  'virtual',
  'gpu',
  'footprint',
  'wakeups',
  'owning_app',
  'cgroup',
] as const

export type TuiColumn = (typeof TUI_COLUMNS)[number]

export interface TuiConfig {
  columns: TuiColumn[]
  /** How often the screen asks for a sample. The delta window stays record.sampleMs. */
  refreshMs: number
  theme: string
}

export interface ProcessGroup {
  name: string
  patterns: string[]
}

export const DEFAULT_TUI: TuiConfig = {
  columns: ['pid', 'name', 'command', 'threads', 'user', 'memory', 'cpu'],
  refreshMs: 1000,
  theme: 'charm',
}

const TUI_COLUMN_SET = new Set<string>(TUI_COLUMNS)

export const DEFAULTS: Config = {
  record: { processLimit: 30, retentionDays: 30, sampleMs: 500 },
  pins: [],
  groups: [],
  probes: defaultProbes(),
  metrics: { enabled: false, host: '127.0.0.1', port: 9464 },
  tui: { ...DEFAULT_TUI, columns: [...DEFAULT_TUI.columns] },
}

export function configBase(): string {
  return process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config')
}

/** Prefer the new directory. Keep the legacy directory when it is the only one present. */
export function resolveConfigDir(base: string, exists: (path: string) => boolean = existsSync): string {
  const next = join(base, 'sloppytop')
  const legacy = join(base, 'neohtop')
  if (exists(next) || !exists(legacy)) return next
  return legacy
}

export function configDir(): string {
  return resolveConfigDir(configBase())
}

/** Prefer `name` in `dir`. Keep `legacyName` when it is the only file present. */
export function resolveNamedFile(
  dir: string,
  name: string,
  legacyName: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const next = join(dir, name)
  const legacy = join(dir, legacyName)
  if (exists(next) || !exists(legacy)) return next
  return legacy
}

export const configPath = () => join(configDir(), 'config.json')
export const dbPath = () => resolveNamedFile(configDir(), 'sloppytop.db', 'neohtop.db')
export const logPath = () => join(configDir(), 'record.log')

export function ensureConfigDir(): string {
  const dir = configDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Accept a partial or older config file. Unknown pins are dropped, not guessed. */
export function normalizeConfig(raw: unknown): Config {
  const obj =
    raw && typeof raw === 'object'
      ? (raw as {
          record?: unknown
          pins?: unknown
          groups?: unknown
          probes?: unknown
          metrics?: unknown
          tui?: unknown
        })
      : {}
  const record =
    obj.record && typeof obj.record === 'object' ? (obj.record as Partial<Config['record']>) : {}
  const pins = Array.isArray(obj.pins)
    ? obj.pins.filter((pin): pin is string => typeof pin === 'string' && pin.trim().length > 0)
    : []
  return {
    record: { ...DEFAULTS.record, ...record },
    pins: pins.map((pin) => pin.trim()),
    groups: parseGroups(obj.groups),
    probes: parseProbes(obj.probes),
    metrics: parseMetrics(obj.metrics),
    tui: parseTui(obj.tui),
  }
}

function parseTui(raw: unknown): TuiConfig {
  const tui = { ...DEFAULT_TUI, columns: [...DEFAULT_TUI.columns] }
  if (!raw || typeof raw !== 'object') return tui
  const record = raw as { columns?: unknown; refreshMs?: unknown; theme?: unknown }
  if (Array.isArray(record.columns)) {
    const columns: TuiColumn[] = []
    for (const column of record.columns) {
      if (typeof column !== 'string' || !TUI_COLUMN_SET.has(column) || columns.includes(column as TuiColumn)) continue
      columns.push(column as TuiColumn)
    }
    if (columns.length > 0) tui.columns = columns
  }
  if (
    typeof record.refreshMs === 'number' &&
    Number.isInteger(record.refreshMs) &&
    record.refreshMs >= 200 &&
    record.refreshMs <= 60_000
  ) {
    tui.refreshMs = record.refreshMs
  }
  if (typeof record.theme === 'string' && isThemeName(record.theme)) tui.theme = record.theme
  return tui
}

/** Go screen file. Prefer sloppytop-cli. Keep neohtop-cli when it is the only file. */
export function goTuiConfigPath(home: string, exists: (path: string) => boolean = existsSync): string {
  const next = join(home, '.config', 'sloppytop-cli', 'config.json')
  const legacy = join(home, '.config', 'neohtop-cli', 'config.json')
  if (!home) return next
  if (exists(next) || !exists(legacy)) return next
  return legacy
}

/** Read a Go screen config. Returns null when the file has none of the screen keys. */
export function tuiFromGo(raw: unknown): TuiConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as { columns?: unknown; refresh_rate_ms?: unknown; theme?: unknown }
  if (!('columns' in record) && !('refresh_rate_ms' in record) && !('theme' in record)) return null
  return parseTui({ columns: record.columns, refreshMs: record.refresh_rate_ms, theme: record.theme })
}

/**
 * Use the screen block already in the TypeScript config.
 * When that block is absent, copy columns, theme, and refresh from the Go file once.
 */
export function resolveTui(file: unknown, goFile: unknown): { tui: TuiConfig; imported: boolean } {
  const hasTui = !!file && typeof file === 'object' && 'tui' in file
  const config = normalizeConfig(file)
  if (hasTui) return { tui: config.tui, imported: false }
  const imported = tuiFromGo(goFile)
  if (!imported) return { tui: config.tui, imported: false }
  return { tui: imported, imported: true }
}

function parseMetrics(raw: unknown): MetricsConfig {
  const metrics = { ...DEFAULTS.metrics }
  if (!raw || typeof raw !== 'object') return metrics
  const record = raw as { enabled?: unknown; host?: unknown; port?: unknown }
  metrics.enabled = record.enabled === true
  if (typeof record.host === 'string') {
    const host = record.host.trim()
    if (host.length > 0 && host.length <= 253 && /^[A-Za-z0-9.:%-]+$/.test(host)) metrics.host = host
  }
  if (typeof record.port === 'number' && Number.isInteger(record.port) && record.port >= 1 && record.port <= 65535) {
    metrics.port = record.port
  }
  return metrics
}

function parseGroups(raw: unknown): ProcessGroup[] {
  if (!Array.isArray(raw)) return []
  const groups: ProcessGroup[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const name = (item as { name?: unknown }).name
    const patterns = (item as { patterns?: unknown }).patterns
    if (typeof name !== 'string' || name.trim().length === 0 || !Array.isArray(patterns)) continue
    const kept = patterns.filter((pattern): pattern is string => typeof pattern === 'string' && pattern.trim().length > 0)
    if (kept.length === 0) continue
    groups.push({ name: name.trim(), patterns: kept.map((pattern) => pattern.trim()) })
  }
  return groups
}

export function loadConfig(): Config {
  try {
    return normalizeConfig(JSON.parse(readFileSync(configPath(), 'utf8')))
  } catch {
    return structuredClone(DEFAULTS)
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Load the TypeScript config. When it has no screen block, copy columns, theme,
 * and refresh from the Go screen file once and write them here. The Go file is not modified.
 */
export function ensureTuiConfig(): Config {
  let file: unknown = null
  let readable = false
  if (existsSync(configPath())) {
    try {
      file = JSON.parse(readFileSync(configPath(), 'utf8'))
      readable = true
    } catch {
      return loadConfig()
    }
  }
  const resolved = resolveTui(readable ? file : null, readJson(goTuiConfigPath(homedir())))
  const config = readable ? normalizeConfig(file) : structuredClone(DEFAULTS)
  if (!resolved.imported) return config
  config.tui = resolved.tui
  saveConfig(config)
  return config
}

export function saveConfig(config: Config): void {
  ensureConfigDir()
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`)
}

/** Write defaults if no config exists yet; returns effective config */
export function initConfig(): Config {
  if (!existsSync(configPath())) saveConfig(DEFAULTS)
  return loadConfig()
}

export function updateProbes(names: ProbeName[], enabled: boolean): Config {
  const config = loadConfig()
  for (const name of names) config.probes[name] = enabled
  saveConfig(config)
  return config
}

export function updateMetrics(patch: Partial<MetricsConfig>): Config {
  const config = loadConfig()
  config.metrics = { ...config.metrics, ...patch }
  saveConfig(config)
  return loadConfig()
}
