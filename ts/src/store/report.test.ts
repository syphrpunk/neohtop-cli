import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { insertSample, openDb } from './db.ts'
import { reportAnomalies, reportHourly, reportTopConsumers, reportWindow } from './report.ts'

const baseSystem: SystemStats = {
  cpu_brand: 'test',
  cpu_usage_per_core: [10, 10, 10, 10],
  cpu_usage_total: 30,
  core_count: 4,
  memory_total: 16_000,
  memory_used: 8_000,
  memory_free: 8_000,
  uptime_secs: 100,
  load_avg: [1, 1, 1],
  network_rx_bytes: 0,
  network_tx_bytes: 0,
  disk_total_bytes: 100,
  disk_used_bytes: 50,
  disk_free_bytes: 50,
  hostname: 'test',
  os_version: 'test',
  kernel_version: 'test',
  process_count: 10,
}

const proc = (name: string, cpu: number, mem = 100): ProcessInfo => ({
  pid: 1,
  ppid: 0,
  name,
  cpu_usage: cpu,
  memory_bytes: mem,
  status: 'Running',
  user: 'dk',
  command: name,
  runtime_secs: 10,
  disk_read_bytes: 0,
  disk_write_bytes: 0,
})

const record = (
  db: Database,
  at: string,
  overrides: Partial<SystemStats> = {},
  procs: ProcessInfo[] = [],
) =>
  insertSample(db, at, { ...baseSystem, ...overrides }, procs, {
    processLimit: 30,
    retentionDays: 365,
  })

describe('report', () => {
  let db: Database
  beforeEach(() => {
    db = openDb(':memory:')
  })
  afterEach(() => db.close())

  test('reportWindow is null with no samples in range', () => {
    expect(reportWindow(db, '2026-01-01T00:00:00Z')).toBeNull()
  })

  test('hourly buckets aggregate avg and peak per hour', () => {
    record(db, '2026-08-17T10:05:00.000Z', { cpu_usage_total: 20 })
    record(db, '2026-08-17T10:35:00.000Z', { cpu_usage_total: 40 })
    record(db, '2026-08-17T11:05:00.000Z', { cpu_usage_total: 60 })
    const hourly = reportHourly(db, '2026-08-17T00:00:00Z')
    expect(hourly).toHaveLength(2)
    expect(hourly[0]).toMatchObject({
      hour: '2026-08-17T10:00Z',
      samples: 2,
      cpu_avg: 30,
      cpu_peak: 40,
    })
    expect(hourly[1]).toMatchObject({ hour: '2026-08-17T11:00Z', samples: 1, cpu_avg: 60 })
  })

  test('top consumers rank by avg cpu weighted by appearances', () => {
    record(db, '2026-08-17T10:00:00.000Z', {}, [proc('chrome', 60), proc('idle-thing', 90)])
    record(db, '2026-08-17T11:00:00.000Z', {}, [proc('chrome', 40)])
    const top = reportTopConsumers(db, '2026-08-17T00:00:00Z', 10)
    // chrome: avg 50 × 2 appearances = 100 > idle-thing: 90 × 1
    expect(top[0]).toMatchObject({ name: 'chrome', appearances: 2, cpu_avg: 50, cpu_max: 60 })
    expect(top[1]).toMatchObject({ name: 'idle-thing', appearances: 1 })
  })

  test('io_pressure flags high load at moderate CPU', () => {
    // 4 cores, load 12, cpu 45% — the 2026-08-17 shape
    record(db, '2026-08-17T03:16:00.000Z', { load_avg: [12, 5, 3], cpu_usage_total: 45 })
    record(db, '2026-08-17T04:00:00.000Z') // healthy
    const anomalies = reportAnomalies(db, '2026-08-17T00:00:00Z')
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toMatchObject({ type: 'io_pressure', load_1: 12 })
  })

  test('cpu_saturation and memory_pressure flag independently', () => {
    record(db, '2026-08-17T05:00:00.000Z', {
      cpu_usage_total: 95,
      memory_used: 15_000,
      memory_free: 1_000,
    })
    const types = reportAnomalies(db, '2026-08-17T00:00:00Z').map((a) => a.type)
    expect(types).toContain('cpu_saturation')
    expect(types).toContain('memory_pressure')
    expect(types).not.toContain('io_pressure')
  })
})
