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
}

export const DEFAULTS: Config = {
  record: { processLimit: 30, retentionDays: 30, sampleMs: 500 },
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

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8'))
    return { record: { ...DEFAULTS.record, ...raw.record } }
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
