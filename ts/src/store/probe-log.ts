// One JSON line per enabled probe. Retrieved with `sloppytop log`.
// A write failure does not change the command result.

import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { join } from 'node:path'
import type { ProbeLogEntry, ProbeName } from '../monitor/probes.ts'
import { configDir } from './config.ts'

const DEFAULT_MAX = 8_000_000
const DEFAULT_KEEP = 4_000_000

export function probeLogPath(): string {
  return join(configDir(), 'probes.jsonl')
}

export function appendProbeLog(
  entries: ProbeLogEntry[],
  file = probeLogPath(),
  limits: { max: number; keep: number } = { max: DEFAULT_MAX, keep: DEFAULT_KEEP },
): void {
  if (entries.length === 0) return
  const text = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  try {
    mkdirSync(dirname(file), { recursive: true })
    rotate(file, limits)
    appendFileSync(file, text)
  } catch {
    // The command result is the source of truth.
  }
}

export function readProbeLog(
  options: { file?: string; probe?: ProbeName; limit?: number } = {},
): ProbeLogEntry[] {
  const limit = options.limit ?? 50
  let text: string
  try {
    text = readFileSync(options.file ?? probeLogPath(), 'utf8')
  } catch {
    return []
  }
  const parsed: ProbeLogEntry[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const value = JSON.parse(line) as ProbeLogEntry
      if (!value || typeof value !== 'object' || typeof value.probe !== 'string') continue
      if (options.probe && value.probe !== options.probe) continue
      parsed.push(value)
    } catch {
      // A torn line from rotation is skipped.
    }
  }
  return parsed.slice(-limit)
}

function rotate(file: string, limits: { max: number; keep: number }): void {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    return
  }
  if (size <= limits.max || limits.keep <= 0) return
  const keep = Math.min(limits.keep, size)
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(keep)
    readSync(fd, buf, 0, keep, size - keep)
    const text = buf.toString('utf8')
    const cut = text.indexOf('\n')
    writeFileSync(file, cut === -1 ? '' : text.slice(cut + 1))
  } finally {
    closeSync(fd)
  }
}
