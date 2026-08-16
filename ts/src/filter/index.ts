// Port of the Go filter package — regex search and column sorting.

import type { ProcessInfo } from '../monitor/types.ts'

export const SORT_KEYS = ['cpu', 'memory', 'pid', 'name', 'runtime', 'user'] as const
export type SortKey = (typeof SORT_KEYS)[number]

/**
 * Regex filter (case-insensitive) against name, command, and PID — same
 * semantics as the Go TUI search. An invalid pattern falls back to a
 * literal substring match rather than erroring.
 */
export function filterProcesses(
  procs: ProcessInfo[],
  query?: string,
  user?: string,
): ProcessInfo[] {
  let out = procs
  if (user) out = out.filter((p) => p.user === user)
  if (query) {
    let matches: (p: ProcessInfo) => boolean
    try {
      const re = new RegExp(query, 'i')
      matches = (p) => re.test(p.name) || re.test(p.command) || re.test(String(p.pid))
    } catch {
      const q = query.toLowerCase()
      matches = (p) =>
        p.name.toLowerCase().includes(q) ||
        p.command.toLowerCase().includes(q) ||
        String(p.pid).includes(q)
    }
    out = out.filter(matches)
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
