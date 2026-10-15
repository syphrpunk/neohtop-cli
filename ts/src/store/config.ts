// Persistent user config. State lives under ~/.config/sloppytop/
// (XDG_CONFIG_HOME respected): config.json, the metrics SQLite DB, and the
// recorder log. An existing ~/.config/neohtop directory is kept so a rename
// does not orphan recorded samples.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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
}

export interface ProcessGroup {
  name: string
  patterns: string[]
}

export const DEFAULTS: Config = {
  record: { processLimit: 30, retentionDays: 30, sampleMs: 500 },
  pins: [],
  groups: [],
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
      ? (raw as { record?: unknown; pins?: unknown; groups?: unknown })
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
  }
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

export function saveConfig(config: Config): void {
  ensureConfigDir()
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`)
}

/** Write defaults if no config exists yet; returns effective config */
export function initConfig(): Config {
  if (!existsSync(configPath())) saveConfig(DEFAULTS)
  return loadConfig()
}
