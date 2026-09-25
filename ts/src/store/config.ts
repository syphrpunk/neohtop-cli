// Persistent user config — argo-style: everything lives under
// ~/.config/neohtop/ (XDG_CONFIG_HOME respected): config.json, the
// metrics SQLite DB, and the launchd job log.

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
}

export const DEFAULTS: Config = {
  record: { processLimit: 30, retentionDays: 30, sampleMs: 500 },
  pins: [],
}

export function configDir(): string {
  const base = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config')
  return join(base, 'neohtop')
}

export const configPath = () => join(configDir(), 'config.json')
export const dbPath = () => join(configDir(), 'neohtop.db')
export const logPath = () => join(configDir(), 'record.log')

export function ensureConfigDir(): string {
  const dir = configDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Accept a partial or older config file. Unknown pins are dropped, not guessed. */
export function normalizeConfig(raw: unknown): Config {
  const obj = raw && typeof raw === 'object' ? (raw as { record?: unknown; pins?: unknown }) : {}
  const record =
    obj.record && typeof obj.record === 'object' ? (obj.record as Partial<Config['record']>) : {}
  const pins = Array.isArray(obj.pins)
    ? obj.pins.filter((pin): pin is string => typeof pin === 'string' && pin.trim().length > 0)
    : []
  return {
    record: { ...DEFAULTS.record, ...record },
    pins: pins.map((pin) => pin.trim()),
  }
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
