import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { dbInfo, insertSample, openDb, queryHistory, queryTopProcesses } from './db.ts'

const system: SystemStats = {
  cpu_brand: 'Test CPU',
  cpu_usage_per_core: [10, 20],
  cpu_usage_total: 15,
  core_count: 2,
  memory_total: 1000,
  memory_used: 600,
  memory_free: 400,
  uptime_secs: 100,
  load_avg: [1, 2, 3],
  network_rx_bytes: 50,
  network_tx_bytes: 25,
  disk_total_bytes: 5000,
  disk_used_bytes: 2500,
  disk_free_bytes: 2500,
  hostname: 'testhost',
  os_version: 'TestOS',
  kernel_version: '1.0',
  process_count: 3,
}

function proc(pid: number, cpu: number): ProcessInfo {
  return {
    pid,
    ppid: 1,
    name: `p${pid}`,
    cpu_usage: cpu,
    memory_bytes: pid * 100,
    status: 'Running',
    user: 'test',
    command: `/bin/p${pid}`,
    runtime_secs: 10,
    disk_read_bytes: 0,
    disk_write_bytes: 0,
  }
}

describe('metrics store', () => {
  test('insert, query back, top-N limit', () => {
    const db = openDb(':memory:')
    const procs = [proc(1, 5), proc(2, 50), proc(3, 25)]
    const at = new Date().toISOString()
    const result = insertSample(db, at, system, procs, { processLimit: 2, retentionDays: 30 })
    expect(result.processesStored).toBe(2)

    const rows = queryHistory(db, new Date(Date.now() - 3_600_000).toISOString(), 10)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.cpu_usage_total).toBe(15)
    expect(rows[0]!.memory_used).toBe(600)

    // top-N kept by CPU, ordered desc
    const top = queryTopProcesses(db, result.sampleId)
    expect(top.map((p) => p['pid'])).toEqual([2, 3])
    db.close()
  })

  test('retention prunes old samples and cascades processes', () => {
    const db = openDb(':memory:')
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
    const first = insertSample(db, old, system, [proc(1, 5)], {
      processLimit: 5,
      retentionDays: 30,
    })
    const result = insertSample(db, new Date().toISOString(), system, [proc(2, 5)], {
      processLimit: 5,
      retentionDays: 30,
    })
    expect(result.pruned).toBe(1)
    expect(dbInfo(db).samples).toBe(1)
    expect(queryTopProcesses(db, first.sampleId)).toHaveLength(0) // cascade
    db.close()
  })

  test('history window excludes samples before cutoff', () => {
    const db = openDb(':memory:')
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString()
    insertSample(db, twoHoursAgo, system, [], { processLimit: 5, retentionDays: 30 })
    insertSample(db, new Date().toISOString(), system, [], { processLimit: 5, retentionDays: 30 })
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    expect(queryHistory(db, oneHourAgo, 10)).toHaveLength(1)
    db.close()
  })

  test('stores swap and a not-charging battery, and omits them when absent', () => {
    const db = openDb(':memory:')
    const since = new Date(Date.now() - 3_600_000).toISOString()
    insertSample(db, new Date().toISOString(), system, [], { processLimit: 1, retentionDays: 30 })
    insertSample(
      db,
      new Date().toISOString(),
      {
        ...system,
        swap_total_bytes: 2048,
        swap_used_bytes: 512,
        battery_charge_percent: 80,
        battery_charging: false,
        cpu_power_watts: 4.5,
        ane_power_watts: 0,
        disk_devices: [
          {
            name: 'disk0',
            read_bytes_per_s: 100,
            write_bytes_per_s: 0,
            read_iops: 1.5,
            write_iops: 0,
            read_latency_ms: 0.2,
          },
        ],
      },
      [],
      { processLimit: 1, retentionDays: 30 },
    )
    const rows = queryHistory(db, since, 10)
    const plain = rows.find((r) => r.swap_total_bytes === undefined)!
    expect(plain).not.toHaveProperty('swap_total_bytes')
    expect(plain).not.toHaveProperty('battery_charging')
    const rich = rows.find((r) => r.swap_total_bytes !== undefined)!
    expect(rich.swap_used_bytes).toBe(512)
    expect(rich.battery_charge_percent).toBe(80)
    expect(rich.battery_charging).toBe(false)
    expect(rich.cpu_power_watts).toBe(4.5)
    expect(rich.ane_power_watts).toBe(0)
    expect(rich.disk_devices).toEqual([
      {
        name: 'disk0',
        read_bytes_per_s: 100,
        write_bytes_per_s: 0,
        read_iops: 1.5,
        write_iops: 0,
        read_latency_ms: 0.2,
      },
    ])
    expect(plain).not.toHaveProperty('cpu_power_watts')
    expect(plain).not.toHaveProperty('disk_devices')
    db.close()
  })

  test('adds nullable columns to a database created before swap and battery', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sloppytop-db-'))
    const path = join(dir, 'old.db')
    const old = new Database(path)
    old.run(`CREATE TABLE system_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      hostname TEXT NOT NULL,
      cpu_usage_total REAL NOT NULL,
      cpu_usage_per_core TEXT NOT NULL,
      memory_total INTEGER NOT NULL,
      memory_used INTEGER NOT NULL,
      memory_free INTEGER NOT NULL,
      load_1 REAL NOT NULL,
      load_5 REAL NOT NULL,
      load_15 REAL NOT NULL,
      network_rx_bytes INTEGER NOT NULL,
      network_tx_bytes INTEGER NOT NULL,
      disk_total_bytes INTEGER NOT NULL,
      disk_used_bytes INTEGER NOT NULL,
      disk_free_bytes INTEGER NOT NULL,
      uptime_secs INTEGER NOT NULL,
      process_count INTEGER NOT NULL
    )`)
    old.close()

    const db = openDb(path)
    const names = (db.prepare('PRAGMA table_info(system_samples)').all() as { name: string }[]).map(
      (c) => c.name,
    )
    expect(names).toContain('swap_used_bytes')
    expect(names).toContain('battery_charging')
    expect(names).toContain('psi_io_some_avg10')
    expect(names).toContain('memory_pressure_level')
    expect(names).toContain('cpu_power_watts')
    expect(names).toContain('disk_devices')
    insertSample(
      db,
      new Date().toISOString(),
      { ...system, swap_total_bytes: 100, swap_used_bytes: 40 },
      [],
      { processLimit: 1, retentionDays: 30 },
    )
    const row = queryHistory(db, new Date(Date.now() - 3_600_000).toISOString(), 1)[0]!
    expect(row.swap_used_bytes).toBe(40)
    expect(row).not.toHaveProperty('battery_charge_percent')
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
