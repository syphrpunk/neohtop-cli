// History, report, probe log, one-shot record, and the metrics listener.
// The table tick does not call these. Tests pass probes and samples in;
// the defaults below open the real store and are only for the screen.

import type { Database } from 'bun:sqlite'
import { disabledRecordProbes, type ProbeSet } from '../monitor/probes.ts'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { takeSample } from '../sample.ts'
import { loadConfig } from '../store/config.ts'
import { insertSample, openDb, queryHistory, type HistoryRow } from '../store/db.ts'
import { metricsResponse } from '../store/metrics.ts'
import { readProbeLog } from '../store/probe-log.ts'
import {
  reportAnomalies,
  reportGroups,
  reportHourly,
  reportLeaks,
  reportTopConsumers,
  reportWindow,
} from '../store/report.ts'
import { status, type StatusResult } from '../store/service.ts'
import type {
  HistoryView,
  ReportAnomalyLine,
  ReportGroupLine,
  ReportHourLine,
  ReportLeakLine,
  ReportTopLine,
  ReportView,
  ScreenEffect,
} from './state.ts'

export const EMPTY_WINDOW =
  "no samples in the last 24h — run 'record' once or 'service install' for hourly recording"

const HISTORY_HOURS = 24
const HISTORY_LIMIT = 120
const CLIP = 48
const HIDDEN_LOG_KEYS = new Set(['cwd', 'environ', 'command', 'local', 'remote'])

export interface RecordDeps {
  sample: () => Promise<{ system: SystemStats; processes: ProcessInfo[] }>
  insert: (system: SystemStats, processes: ProcessInfo[]) => { sampleId: number; processesStored: number }
}

export interface ReportInput {
  hourly: ReportHourLine[]
  top: ReportTopLine[]
  anomalies: ReportAnomalyLine[]
  leaks: ReportLeakLine[]
  groups: ReportGroupLine[]
}

interface MetricsServer {
  port: number
  stop: (closeActiveConnections?: boolean) => void
}

type MetricsServe = (options: {
  hostname: string
  port: number
  fetch: (request: Request) => Response | Promise<Response>
}) => MetricsServer

/** Refuse before sampling. takeSample reloads config, and a missing record column is NOT NULL. */
export async function attemptRecord(
  probes: ProbeSet,
  deps: RecordDeps,
): Promise<{ recorded: boolean; message: string }> {
  const blocked = disabledRecordProbes(probes)
  if (blocked.length > 0) {
    return {
      recorded: false,
      message: `PROBE_DISABLED  record needs these probes enabled: ${blocked.join(', ')}`,
    }
  }
  const { system, processes } = await deps.sample()
  const result = deps.insert(system, processes)
  return { recorded: true, message: `recorded sample ${result.sampleId}  ${result.processesStored} processes` }
}

export function historyView(rows: Pick<HistoryRow, 'at' | 'cpu_usage_total' | 'memory_used' | 'load_1'>[]): HistoryView {
  if (rows.length === 0) {
    return { status: 'empty', message: EMPTY_WINDOW, cpu: [], memory: [], load: [], recent: [] }
  }
  const chrono = [...rows].reverse()
  return {
    status: 'ready',
    message: '',
    cpu: chrono.map((row) => row.cpu_usage_total),
    memory: chrono.map((row) => row.memory_used),
    load: chrono.map((row) => row.load_1),
    recent: rows.slice(0, 5).map((row) => ({
      at: row.at.slice(11, 19),
      cpu: row.cpu_usage_total,
      memory: row.memory_used,
      load: row.load_1,
    })),
  }
}

/** Sample-weighted avg and peak, same rounding as the report command. */
export function reportView(parts: ReportInput | null): ReportView {
  const empty: ReportView = {
    status: 'empty',
    message: EMPTY_WINDOW,
    summary: null,
    cpu: [],
    memory: [],
    load: [],
    hourly: [],
    top: [],
    anomalies: [],
    leaks: [],
    groups: [],
  }
  if (!parts) return empty
  const n = parts.hourly.reduce((sum, hour) => sum + hour.samples, 0)
  if (parts.hourly.length === 0 || n === 0) return empty
  const hourly = parts.hourly
  const weighted = (read: (hour: ReportHourLine) => number) =>
    Math.round((hourly.reduce((sum, hour) => sum + read(hour) * hour.samples, 0) / n) * 10) / 10
  return {
    status: 'ready',
    message: '',
    summary: {
      cpu_avg: weighted((hour) => hour.cpu_avg),
      cpu_peak: Math.max(...hourly.map((hour) => hour.cpu_peak)),
      memory_used_avg: Math.round(hourly.reduce((sum, hour) => sum + hour.memory_used_avg * hour.samples, 0) / n),
      memory_used_peak: Math.max(...hourly.map((hour) => hour.memory_used_peak)),
      load1_avg: weighted((hour) => hour.load1_avg),
      load1_peak: Math.max(...hourly.map((hour) => hour.load1_peak)),
      anomaly_count: parts.anomalies.length,
    },
    cpu: hourly.map((hour) => hour.cpu_avg),
    memory: hourly.map((hour) => hour.memory_used_avg),
    load: hourly.map((hour) => hour.load1_avg),
    hourly,
    top: parts.top.slice(0, 5),
    anomalies: parts.anomalies.slice(0, 3),
    leaks: parts.leaks.slice(0, 3),
    groups: parts.groups.slice(0, 3),
  }
}

/** Primitives and array lengths only. Path and address keys are dropped, not clipped. */
export function logView(entries: readonly unknown[]): { lines: string[] } {
  const lines: string[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const parts: string[] = []
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (HIDDEN_LOG_KEYS.has(key) || value == null) continue
      if (typeof value === 'string') parts.push(`${key} ${clipLog(value)}`)
      else if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${key} ${String(value)}`)
      else if (Array.isArray(value)) parts.push(`${key} ${value.length}`)
    }
    if (parts.length > 0) lines.push(parts.join('  '))
  }
  return { lines }
}

export function readService(load: () => StatusResult = status): { line: string } {
  try {
    const result = load()
    const installed = result.installed ? 'installed' : 'not installed'
    const loaded = result.loaded ? 'loaded' : 'not loaded'
    return { line: `service  ${result.scheduler}  ${installed}  ${loaded}` }
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'service status failed'
    return { line: message }
  }
}

export function bindMetricsListener(
  opts: { host: string; port: number; sample: () => Promise<Partial<SystemStats>> },
  serve: MetricsServe = Bun.serve as unknown as MetricsServe,
): { ok: true; port: number; stop: () => void } | { ok: false; message: string } {
  try {
    const server = serve({
      hostname: opts.host,
      port: opts.port,
      fetch: (request) => metricsResponse(request, opts.sample),
    })
    return {
      ok: true,
      port: server.port,
      stop: () => {
        server.stop(true)
      },
    }
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'metrics bind failed'
    return { ok: false, message }
  }
}

export function hasStoreEffect(effect: ScreenEffect): boolean {
  return (
    effect.openHistory === true ||
    effect.openReport === true ||
    effect.openLog === true ||
    effect.openSettings === true ||
    effect.record === true
  )
}

export async function recordWithStore(): Promise<{ recorded: boolean; message: string }> {
  const config = loadConfig()
  return attemptRecord(config.probes, {
    sample: async () => {
      const sample = await takeSample(loadConfig().record.sampleMs)
      return { system: sample.system, processes: sample.processes }
    },
    insert: (system, processes) => {
      const record = loadConfig().record
      const db = openDb()
      try {
        const result = insertSample(db, new Date().toISOString(), system, processes, record)
        return { sampleId: result.sampleId, processesStored: result.processesStored }
      } finally {
        db.close()
      }
    },
  })
}

export function loadHistory(): HistoryView {
  return withDb((db) => {
    const since = new Date(Date.now() - HISTORY_HOURS * 3_600_000).toISOString()
    return historyView(queryHistory(db, since, HISTORY_LIMIT))
  })
}

export function loadReport(): ReportView {
  return withDb((db) => {
    const since = new Date(Date.now() - HISTORY_HOURS * 3_600_000).toISOString()
    if (!reportWindow(db, since)) return reportView(null)
    const hourly = reportHourly(db, since)
    const top = reportTopConsumers(db, since, 5).map((row) => ({
      name: row.name,
      cpu_avg: row.cpu_avg,
      memory_avg_bytes: row.memory_avg_bytes,
    }))
    const anomalies = reportAnomalies(db, since).map((row) => ({ at: row.at, type: row.type, detail: row.detail }))
    const leaks = reportLeaks(db, since).map((row) => ({
      name: row.name,
      metric: row.metric,
      total_growth_bytes: row.total_growth_bytes,
    }))
    const groups = reportGroups(db, since, loadConfig().groups).map((row) => ({ name: row.name, score: row.score }))
    return reportView({ hourly, top, anomalies, leaks, groups })
  })
}

export function loadLog(): { lines: string[] } {
  return logView(readProbeLog({ limit: 50 }))
}

function withDb<T>(read: (db: Database) => T): T {
  const db = openDb()
  try {
    return read(db)
  } finally {
    db.close()
  }
}

function clipLog(value: string): string {
  const flat = value.replace(/\s+/g, ' ')
  const chars = [...flat]
  if (chars.length <= CLIP) return chars.join('')
  return `${chars.slice(0, CLIP - 1).join('')}…`
}
