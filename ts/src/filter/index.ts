// Port of the Go filter package — regex search and column sorting.

import type { ProcessInfo } from '../monitor/types.ts'

export const SORT_KEYS = ['cpu', 'memory', 'pid', 'name', 'runtime', 'user'] as const
export type SortKey = (typeof SORT_KEYS)[number]

/**
 * Compile a filter query into a regex (case-insensitive).
 *
 * Bare words (no regex metacharacters) get word-boundary anchors so
 * `bun` matches "bun run x" and "/bin/bun" but not "Engine.bundle".
 * Patterns containing metacharacters are used as-is, matching the Go
 * TUI search. An invalid pattern falls back to an escaped literal.
 */
export function compileFilter(query: string): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const isBare = /^[\w. -]+$/.test(query)
  if (isBare) {
    // only anchor ends that sit against a word character ("\b\.log\b" would never match)
    const lead = /^\w/.test(query) ? '\\b' : ''
    const trail = /\w$/.test(query) ? '\\b' : ''
    return new RegExp(`${lead}${escaped}${trail}`, 'i')
  }
  try {
    return new RegExp(query, 'i')
  } catch {
    return new RegExp(escaped, 'i')
  }
}

/** Filter against name, command, and PID — same fields as the Go TUI search. */
export function filterProcesses(
  procs: ProcessInfo[],
  query?: string,
  user?: string,
): ProcessInfo[] {
  let out = procs
  if (user) out = out.filter((p) => p.user === user)
  if (query) {
    const re = compileFilter(query)
    out = out.filter((p) => re.test(p.name) || re.test(p.command) || re.test(String(p.pid)))
  }
  return out
}

export function sortProcesses(
  procs: ProcessInfo[],
  by: SortKey = 'cpu',
  order: 'asc' | 'desc' = 'desc',
): ProcessInfo[] {
  const dir = order === 'asc' ? 1 : -1
  const key: (p: ProcessInfo) => number | string = {
    cpu: (p: ProcessInfo) => p.cpu_usage,
    memory: (p: ProcessInfo) => p.memory_bytes,
    pid: (p: ProcessInfo) => p.pid,
    name: (p: ProcessInfo) => p.name.toLowerCase(),
    runtime: (p: ProcessInfo) => p.runtime_secs,
    user: (p: ProcessInfo) => p.user.toLowerCase(),
  }[by]
  return [...procs].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka < kb) return -dir
    if (ka > kb) return dir
    return a.pid - b.pid // stable tiebreak
  })
}
