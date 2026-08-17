// Aggregate reporting over the metrics store — replaces the ad-hoc sqlite3
// queries used during analysis sessions. Pure SQL + small TS post-passes;
// all shapes stay snake_case like the rest of the CLI output.

import type { Database } from 'bun:sqlite'
import { availableParallelism } from 'node:os'

export interface ReportWindow {
  hours: number
  from: string
  to: string
  samples: number
}

export interface HourlyRow {
  hour: string
  samples: number
  cpu_avg: number
  cpu_peak: number
  memory_used_avg: number
  memory_used_peak: number
  load1_avg: number
  load1_peak: number
  process_count_avg: number
}

export interface TopConsumer {
  name: string
  appearances: number
  cpu_avg: number
  cpu_max: number
  memory_avg_bytes: number
  memory_max_bytes: number
  users: string
}

export interface Anomaly {
  at: string
  type: 'io_pressure' | 'cpu_saturation' | 'memory_pressure'
  detail: string
  cpu_usage_total: number
  load_1: number
  memory_used_pct: number
}

interface SampleRow {
  at: string
  cpu_usage_total: number
  cpu_usage_per_core: string
  memory_used: number
  memory_total: number
  load_1: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function reportWindow(db: Database, sinceIso: string): ReportWindow | null {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last FROM system_samples WHERE at >= ?',
    )
    .get(sinceIso) as { n: number; first: string | null; last: string | null }
  if (row.n === 0 || !row.first || !row.last) return null
  return { hours: 0, from: row.first, to: row.last, samples: row.n }
}

export function reportHourly(db: Database, sinceIso: string): HourlyRow[] {
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%dT%H:00Z', at) AS hour,
              COUNT(*) AS samples,
              AVG(cpu_usage_total) AS cpu_avg,
              MAX(cpu_usage_total) AS cpu_peak,
              AVG(memory_used) AS memory_used_avg,
              MAX(memory_used) AS memory_used_peak,
              AVG(load_1) AS load1_avg,
              MAX(load_1) AS load1_peak,
              AVG(process_count) AS process_count_avg
       FROM system_samples WHERE at >= ?
       GROUP BY hour ORDER BY hour`,
    )
    .all(sinceIso) as HourlyRow[]
  return rows.map((r) => ({
    ...r,
    cpu_avg: round1(r.cpu_avg),
    cpu_peak: round1(r.cpu_peak),
    memory_used_avg: Math.round(r.memory_used_avg),
    load1_avg: round1(r.load1_avg),
    load1_peak: round1(r.load1_peak),
    process_count_avg: Math.round(r.process_count_avg),
  }))
}

export function reportTopConsumers(db: Database, sinceIso: string, limit: number): TopConsumer[] {
  const rows = db
    .prepare(
      `SELECT p.name,
              COUNT(*) AS appearances,
              AVG(p.cpu_usage) AS cpu_avg,
              MAX(p.cpu_usage) AS cpu_max,
              AVG(p.memory_bytes) AS memory_avg_bytes,
              MAX(p.memory_bytes) AS memory_max_bytes,
              GROUP_CONCAT(DISTINCT p.user) AS users
       FROM process_samples p
       JOIN system_samples s ON s.id = p.sample_id
       WHERE s.at >= ?
       GROUP BY p.name
       ORDER BY AVG(p.cpu_usage) * COUNT(*) DESC
       LIMIT ?`,
    )
    .all(sinceIso, limit) as TopConsumer[]
  return rows.map((r) => ({
    ...r,
    cpu_avg: round1(r.cpu_avg),
    cpu_max: round1(r.cpu_max),
    memory_avg_bytes: Math.round(r.memory_avg_bytes),
  }))
}

/**
 * Flag samples that look unhealthy:
 * - io_pressure: load1 far above core count while CPU is only moderate —
 *   runnable queue full of tasks stuck in I/O wait (the 2026-08-17 43.2 spike)
 * - cpu_saturation: total CPU above 90%
 * - memory_pressure: memory used above 92% of total
 */
export function reportAnomalies(db: Database, sinceIso: string): Anomaly[] {
  const rows = db
    .prepare(
      `SELECT at, cpu_usage_total, cpu_usage_per_core, memory_used, memory_total, load_1
       FROM system_samples WHERE at >= ? ORDER BY at`,
    )
    .all(sinceIso) as SampleRow[]

  const anomalies: Anomaly[] = []
  for (const r of rows) {
    let cores = 0
    try {
      cores = (JSON.parse(r.cpu_usage_per_core) as unknown[]).length
    } catch {
      // fall through to host fallback
    }
    if (cores === 0) cores = availableParallelism()
    const memPct = r.memory_total > 0 ? (r.memory_used / r.memory_total) * 100 : 0
    const base = {
      at: r.at,
      cpu_usage_total: round1(r.cpu_usage_total),
      load_1: round1(r.load_1),
      memory_used_pct: round1(memPct),
    }
    if (r.load_1 > cores * 2 && r.cpu_usage_total < 60) {
      anomalies.push({
        ...base,
        type: 'io_pressure',
        detail: `load1 ${round1(r.load_1)} is ${round1(r.load_1 / cores)}x core count (${cores}) at only ${round1(r.cpu_usage_total)}% CPU — likely I/O wait`,
      })
    }
    if (r.cpu_usage_total > 90) {
      anomalies.push({
        ...base,
        type: 'cpu_saturation',
        detail: `total CPU ${round1(r.cpu_usage_total)}%`,
      })
    }
    if (memPct > 92) {
      anomalies.push({
        ...base,
        type: 'memory_pressure',
        detail: `memory ${round1(memPct)}% used (${r.memory_used} of ${r.memory_total} bytes)`,
      })
    }
  }
  return anomalies
}
