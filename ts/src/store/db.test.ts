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
})
