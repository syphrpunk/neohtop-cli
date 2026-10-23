// Memory composition and paging counters. Rates are deltas. A missing key
// is omitted. A present 0 is a measurement. `memory_used` keeps its existing
// meaning: macOS active + wired + compressor, Linux MemTotal − MemAvailable.

import type { PageCounters } from './types.ts'

export interface HostMemory {
  used: number
  free: number
  wired?: number
  compressed?: number
  app?: number
  cached?: number
  pages: PageCounters
}

/** `vm_stat` page counts. The header is ignored; the caller supplies the page size. */
export function parseVmStat(text: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^(.+):\s+(\d+)\.$/)
    if (m) counts[m[1]!.trim()] = Number(m[2])
  }
  return counts
}

/**
 * macOS composition. App, wired, and compressed are the three parts of
 * `used`. Cached is file-backed and is not part of that total.
 */
export function memoryFromVmStat(text: string, pageSize: number, total: number): HostMemory {
  const counts = parseVmStat(text)
  const pages = (key: string): number | undefined => {
    const n = counts[key]
    if (n === undefined || !(pageSize > 0)) return
    return n * pageSize
  }
  const active = counts['Pages active'] ?? 0
  const wired = counts['Pages wired down'] ?? 0
  const compressor = counts['Pages occupied by compressor'] ?? 0
  const scale = pageSize > 0 ? pageSize : 0
  const used = (active + wired + compressor) * scale
  const pageCounters: PageCounters = {}
  const events = (key: string, field: keyof PageCounters) => {
    const n = counts[key]
    if (n !== undefined) pageCounters[field] = n
  }
  events('Pageins', 'pageins')
  events('Pageouts', 'pageouts')
  events('Compressions', 'compressions')
  events('Decompressions', 'decompressions')
  return {
    used,
    free: total - used,
    ...(counts['Pages wired down'] !== undefined && pages('Pages wired down') !== undefined
      ? { wired: pages('Pages wired down') }
      : {}),
    ...(counts['Pages occupied by compressor'] !== undefined &&
    pages('Pages occupied by compressor') !== undefined
      ? { compressed: pages('Pages occupied by compressor') }
      : {}),
    ...(counts['Pages active'] !== undefined && pages('Pages active') !== undefined
      ? { app: pages('Pages active') }
      : {}),
    ...(counts['File-backed pages'] !== undefined && pages('File-backed pages') !== undefined
      ? { cached: pages('File-backed pages') }
      : {}),
    pages: pageCounters,
  }
}

/** `/proc/meminfo` values in bytes. App is AnonPages. Cached is Buffers + Cached. */
export function memoryFromMeminfo(text: string): {
  total: number
  used: number
  free: number
  app?: number
  cached?: number
  compressed?: number
} {
  const kv: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+) kB/)
    if (m) kv[m[1]!] = Number(m[2]) * 1024
  }
  const total = kv['MemTotal'] ?? 0
  const available = kv['MemAvailable'] ?? kv['MemFree'] ?? 0
  const cachedParts = ['Buffers', 'Cached'].filter((key) => kv[key] !== undefined)
  const cached = cachedParts.reduce((sum, key) => sum + kv[key]!, 0)
  const compressed = kv['Zswap'] ?? kv['Zswapped']
  return {
    total,
    used: total - available,
    free: kv['MemFree'] ?? 0,
    ...(kv['AnonPages'] !== undefined ? { app: kv['AnonPages'] } : {}),
    ...(cachedParts.length > 0 ? { cached } : {}),
    ...(compressed !== undefined ? { compressed } : {}),
  }
}

/**
 * `/proc/vmstat`. `pgpgin` and `pgpgout` are kilobytes; they are converted
 * with the page size. `zswpin` and `zswpout` are kept as the kernel counted
 * them. A missing key is omitted.
 */
export function pagingFromVmstat(text: string, pageSize: number): PageCounters {
  const kv: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+)\s+(\d+)$/)
    if (m) kv[m[1]!] = Number(m[2])
  }
  const pages = (kb: number | undefined): number | undefined => {
    if (kb === undefined || !(pageSize > 0)) return
    return (kb * 1024) / pageSize
  }
  const out: PageCounters = {}
  const pageins = pages(kv['pgpgin'])
  const pageouts = pages(kv['pgpgout'])
  if (pageins !== undefined) out.pageins = pageins
  if (pageouts !== undefined) out.pageouts = pageouts
  if (kv['zswpout'] !== undefined) out.compressions = kv['zswpout']
  if (kv['zswpin'] !== undefined) out.decompressions = kv['zswpin']
  return out
}

export interface PageRates {
  pageins_per_s?: number
  pageouts_per_s?: number
  compressions_per_s?: number
  decompressions_per_s?: number
}

/** One field per counter. A backwards counter omits that field. A zero delta stays 0. */
export function pageRates(
  prev: PageCounters | undefined,
  next: PageCounters | undefined,
  elapsedSec: number,
): PageRates {
  const out: PageRates = {}
  if (!prev || !next || !(elapsedSec > 0)) return out
  const take = (
    field: keyof PageCounters,
    dest: keyof PageRates,
  ) => {
    const a = prev[field]
    const b = next[field]
    if (a === undefined || b === undefined || b < a) return
    out[dest] = round3((b - a) / elapsedSec)
  }
  take('pageins', 'pageins_per_s')
  take('pageouts', 'pageouts_per_s')
  take('compressions', 'compressions_per_s')
  take('decompressions', 'decompressions_per_s')
  return out
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
