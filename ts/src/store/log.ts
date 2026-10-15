// One line per command in the config directory (sloppytop.log, or neohtop.log
// when that file already exists). The scheduler still captures record's stdout
// in record.log. A logging failure must not change the command's result.

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { configDir, resolveNamedFile } from './config.ts'

export type LogLevel = 'info' | 'warn' | 'error'

export function eventLogPath(): string {
  return resolveNamedFile(configDir(), 'sloppytop.log', 'neohtop.log')
}

/** Append one event. Newlines are folded so each event stays one line. */
export function logEvent(level: LogLevel, feature: string, message: string, file = eventLogPath()): void {
  const name = feature.replace(/[^\w.-]/g, '') || 'cli'
  const text = message.replace(/[\r\n]+/g, ' ').trim().slice(0, 500)
  const line = `${new Date().toISOString()} ${level} ${name} ${text}\n`
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, line)
  } catch {
    // The command result is the source of truth. The log is best-effort.
  }
}
