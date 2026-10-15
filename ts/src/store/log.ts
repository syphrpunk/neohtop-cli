// One line per command in ~/.config/neohtop/neohtop.log.
// The scheduler still captures record's stdout in record.log.
// A logging failure must not change the command's result.

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { configDir } from './config.ts'

export type LogLevel = 'info' | 'warn' | 'error'

export function eventLogPath(): string {
  return join(configDir(), 'neohtop.log')
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
