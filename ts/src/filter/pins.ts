import { compileFilter } from './index.ts'

/** A row that can be matched by a saved name or command pattern. */
export interface Pinnable {
  name: string
  command: string
}

export interface PinnedSplit<T> {
  /** Matches, in pattern order. Within one pattern, the incoming order is kept. */
  pinned: T[]
  /** Everything else, in the incoming order. */
  rest: T[]
  /** Patterns that matched no row. */
  missing: string[]
}

/** Bare words match the process name only, so a shell echoing `--pin postgres` is not pinned. */
function matchesPin(row: Pinnable, pattern: string, re: RegExp): boolean {
  if (re.test(row.name)) return true
  // A path or a real regex is aimed at the command line.
  if (/^[\w. -]+$/.test(pattern)) return false
  return re.test(row.command)
}

/**
 * Pull pin matches out of an already-sorted list. Bare words use the same
 * whole-word rule as `--filter`, against the process name. A pattern with a
 * path or regex metacharacters is also matched against the command.
 */
export function splitPinned<T extends Pinnable>(rows: T[], patterns: string[]): PinnedSplit<T> {
  const specs = patterns.map((pattern) => ({ pattern, re: compileFilter(pattern) }))
  const taken = new Set<T>()
  const pinned: T[] = []
  const missing: string[] = []
  for (const spec of specs) {
    let hits = 0
    for (const row of rows) {
      if (taken.has(row)) continue
      if (!matchesPin(row, spec.pattern, spec.re)) continue
      taken.add(row)
      pinned.push(row)
      hits++
    }
    if (hits === 0) missing.push(spec.pattern)
  }
  return { pinned, rest: rows.filter((row) => !taken.has(row)), missing }
}
