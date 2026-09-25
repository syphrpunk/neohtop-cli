// Port of the Go filter package — regex search and column sorting.

import type { ProcessInfo } from '../monitor/types.ts'

// Same columns as the Go SortConfig (types.SortBy*)
export const SORT_KEYS = [
  'cpu',
  'memory',
  'pid',
  'name',
  'runtime',
  'user',
  'status',
  'command',
  'disk',
  'threads',
] as const
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

export class FilterQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FilterQueryError'
  }
}

const SIZE_UNIT: Record<string, number> = {
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
}

type Predicate =
  | { kind: 'cpu' | 'mem'; op: '>' | '>='; value: number }
  | { kind: 'pid'; value: number }

/**
 * Commas split terms. Terms that are regexes are OR-ed. Predicates
 * (`cpu>`, `cpu>=`, `mem>`, `mem>=`, `pid:`) are AND-ed with that.
 * A term in double quotes is always a regex, so a comma or `cpu>`
 * inside quotes is not special. Unbalanced quotes and unknown
 * prefixes (`port:`, `user:`) are errors.
 */
function splitTerms(query: string): string[] {
  const terms: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of query) {
    if (ch === '"') {
      quoted = !quoted
      cur += ch
      continue
    }
    if (ch === ',' && !quoted) {
      terms.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (quoted) throw new FilterQueryError('unbalanced quote in filter')
  terms.push(cur)
  return terms
}

function parseSize(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGT])?B?$/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0) return null
  const unit = m[2]?.toUpperCase()
  return Math.round(n * (unit ? SIZE_UNIT[unit]! : 1))
}

function parseCpu(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)%?$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 0 ? n : null
}

function parsePredicate(term: string): Predicate {
  const m = term.match(/^([A-Za-z][A-Za-z0-9]*)\s*(>=|>|:)\s*(.*)$/)
  if (!m) throw new FilterQueryError(`invalid filter term "${term}"`)
  const key = m[1]!.toLowerCase()
  const op = m[2] as '>' | '>=' | ':'
  const raw = m[3]!.trim()
  if (key === 'cpu') {
    if (op === ':') throw new FilterQueryError('cpu filters use > or >=')
    const value = parseCpu(raw)
    if (value === null) throw new FilterQueryError(`invalid cpu threshold "${raw}"`)
    return { kind: 'cpu', op, value }
  }
  if (key === 'mem') {
    if (op === ':') throw new FilterQueryError('mem filters use > or >=')
    const value = parseSize(raw)
    if (value === null) throw new FilterQueryError(`invalid memory size "${raw}"`)
    return { kind: 'mem', op, value }
  }
  if (key === 'pid') {
    if (op !== ':') throw new FilterQueryError('pid filters use pid:N')
    if (!/^\d+$/.test(raw)) throw new FilterQueryError(`invalid pid "${raw}"`)
    return { kind: 'pid', value: Number(raw) }
  }
  throw new FilterQueryError(
    `unknown filter predicate "${term}" (expected cpu>, mem>, or pid:)`,
  )
}

function looksLikePredicate(term: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*\s*(?:>=|>|:)/.test(term)
}

function termText(term: string): { text: string; quoted: boolean } {
  if (term.length >= 2 && term.startsWith('"') && term.endsWith('"')) {
    return { text: term.slice(1, -1), quoted: true }
  }
  return { text: term, quoted: false }
}

function matchesPredicate(proc: ProcessInfo, pred: Predicate): boolean {
  if (pred.kind === 'pid') return proc.pid === pred.value
  const n = pred.kind === 'cpu' ? proc.cpu_usage : proc.memory_bytes
  return pred.op === '>=' ? n >= pred.value : n > pred.value
}

/** Filter against name, command, and PID — same fields as the Go TUI search. */
export function filterProcesses(
  procs: ProcessInfo[],
  query?: string,
  user?: string,
): ProcessInfo[] {
  let out = procs
  if (user) out = out.filter((p) => p.user === user)
  if (!query?.trim()) return out

  const texts: RegExp[] = []
  const preds: Predicate[] = []
  for (const rawTerm of splitTerms(query)) {
    const term = rawTerm.trim()
    if (!term) throw new FilterQueryError('empty filter term')
    const { text, quoted } = termText(term)
    if (!text) throw new FilterQueryError('empty filter term')
    if (!quoted && looksLikePredicate(text)) preds.push(parsePredicate(text))
    else texts.push(compileFilter(text))
  }

  if (texts.length > 0) {
    out = out.filter((p) =>
      texts.some(
        (re) => re.test(p.name) || re.test(p.command) || re.test(String(p.pid)),
      ),
    )
  }
  for (const pred of preds) out = out.filter((p) => matchesPredicate(p, pred))
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
    status: (p: ProcessInfo) => p.status,
    command: (p: ProcessInfo) => p.command.toLowerCase(),
    disk: (p: ProcessInfo) => p.disk_read_bytes + p.disk_write_bytes,
    threads: (p: ProcessInfo) => p.threads ?? 0,
  }[by]
  return [...procs].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka < kb) return -dir
    if (ka > kb) return dir
    return a.pid - b.pid // stable tiebreak
  })
}
