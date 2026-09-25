// Metrics store on bun:sqlite (native — no dependencies). Each `record`
// run inserts one system sample plus the top-N processes; history reads
// the series back for reporting.

import { Database } from 'bun:sqlite'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { dbPath, ensureConfigDir } from './config.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS system_samples (
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
  process_count INTEGER NOT NULL,
  swap_total_bytes INTEGER,
  swap_used_bytes INTEGER,
  battery_charge_percent REAL,
  battery_charging INTEGER,
  psi_cpu_some_avg10 REAL,
  psi_io_some_avg10 REAL,
  psi_memory_some_avg10 REAL,
  memory_pressure_level TEXT,
  cpu_power_watts REAL,
  gpu_power_watts REAL,
  ane_power_watts REAL,
  dram_power_watts REAL
);
CREATE INDEX IF NOT EXISTS idx_system_samples_at ON system_samples(at);
CREATE TABLE IF NOT EXISTS process_samples (
  sample_id INTEGER NOT NULL REFERENCES system_samples(id) ON DELETE CASCADE,
  pid INTEGER NOT NULL,
  ppid INTEGER NOT NULL,
  name TEXT NOT NULL,
  cpu_usage REAL NOT NULL,
  memory_bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  user TEXT NOT NULL,
  command TEXT NOT NULL,
  threads INTEGER,
  runtime_secs INTEGER NOT NULL,
  disk_read_bytes INTEGER NOT NULL,
  disk_write_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_process_samples_sample ON process_samples(sample_id);
CREATE INDEX IF NOT EXISTS idx_process_samples_name ON process_samples(name);
`

const ADDED_SYSTEM_COLUMNS: [name: string, type: string][] = [
  ['swap_total_bytes', 'INTEGER'],
  ['swap_used_bytes', 'INTEGER'],
  ['battery_charge_percent', 'REAL'],
  ['battery_charging', 'INTEGER'],
  ['psi_cpu_some_avg10', 'REAL'],
  ['psi_io_some_avg10', 'REAL'],
  ['psi_memory_some_avg10', 'REAL'],
  ['memory_pressure_level', 'TEXT'],
  ['cpu_power_watts', 'REAL'],
  ['gpu_power_watts', 'REAL'],
  ['ane_power_watts', 'REAL'],
  ['dram_power_watts', 'REAL'],
]

/** Existing databases were created before these columns. CREATE IF NOT EXISTS will not add them. */
function ensureSystemColumns(db: Database) {
  const have = new Set(
    (db.prepare('PRAGMA table_info(system_samples)').all() as { name: string }[]).map((c) => c.name),
  )
  for (const [name, type] of ADDED_SYSTEM_COLUMNS) {
    if (!have.has(name)) db.run(`ALTER TABLE system_samples ADD COLUMN ${name} ${type}`)
  }
}

export function openDb(path = dbPath()): Database {
  if (path !== ':memory:') ensureConfigDir()
  const db = new Database(path, { create: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run(SCHEMA)
  ensureSystemColumns(db)
  return db
}

export interface RecordResult {
  sampleId: number
  processesStored: number
  pruned: number
}

export function insertSample(
  db: Database,
  at: string,
  system: SystemStats,
  processes: ProcessInfo[],
  opts: { processLimit: number; retentionDays: number },
): RecordResult {
  const insertSystem = db.prepare(`
    INSERT INTO system_samples (
      at, hostname, cpu_usage_total, cpu_usage_per_core,
      memory_total, memory_used, memory_free,
      load_1, load_5, load_15,
      network_rx_bytes, network_tx_bytes,
      disk_total_bytes, disk_used_bytes, disk_free_bytes,
      uptime_secs, process_count,
      swap_total_bytes, swap_used_bytes,
      battery_charge_percent, battery_charging,
      psi_cpu_some_avg10, psi_io_some_avg10, psi_memory_some_avg10,
      memory_pressure_level,
      cpu_power_watts, gpu_power_watts, ane_power_watts, dram_power_watts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertProcess = db.prepare(`
    INSERT INTO process_samples (
      sample_id, pid, ppid, name, cpu_usage, memory_bytes,
      status, user, command, threads, runtime_secs,
      disk_read_bytes, disk_write_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const top = [...processes]
    .sort((a, b) => b.cpu_usage - a.cpu_usage || b.memory_bytes - a.memory_bytes)
    .slice(0, opts.processLimit)

  const swapTotalBytes =
    system.swap_total_bytes !== undefined && system.swap_used_bytes !== undefined
      ? system.swap_total_bytes
      : null
  const swapUsedBytes =
    system.swap_total_bytes !== undefined && system.swap_used_bytes !== undefined
      ? system.swap_used_bytes
      : null
  const batteryPercent =
    system.battery_charge_percent !== undefined && system.battery_charging !== undefined
      ? system.battery_charge_percent
      : null
  const batteryCharging =
    system.battery_charge_percent !== undefined && system.battery_charging !== undefined
      ? system.battery_charging
        ? 1
        : 0
      : null
  const psiCpu = system.psi_cpu_some_avg10 !== undefined ? system.psi_cpu_some_avg10 : null
  const psiIo = system.psi_io_some_avg10 !== undefined ? system.psi_io_some_avg10 : null
  const psiMemory = system.psi_memory_some_avg10 !== undefined ? system.psi_memory_some_avg10 : null
  const pressureLevel = system.memory_pressure_level ?? null
  const cpuWatts = system.cpu_power_watts !== undefined ? system.cpu_power_watts : null
  const gpuWatts = system.gpu_power_watts !== undefined ? system.gpu_power_watts : null
  const aneWatts = system.ane_power_watts !== undefined ? system.ane_power_watts : null
  const dramWatts = system.dram_power_watts !== undefined ? system.dram_power_watts : null

  const run = db.transaction(() => {
    const { lastInsertRowid } = insertSystem.run(
      at,
      system.hostname,
      system.cpu_usage_total,
      JSON.stringify(system.cpu_usage_per_core),
      system.memory_total,
      system.memory_used,
      system.memory_free,
      system.load_avg[0],
      system.load_avg[1],
      system.load_avg[2],
      system.network_rx_bytes,
      system.network_tx_bytes,
      system.disk_total_bytes,
      system.disk_used_bytes,
      system.disk_free_bytes,
      system.uptime_secs,
      system.process_count,
      swapTotalBytes,
      swapUsedBytes,
      batteryPercent,
      batteryCharging,
      psiCpu,
      psiIo,
      psiMemory,
      pressureLevel,
      cpuWatts,
      gpuWatts,
      aneWatts,
      dramWatts,
    )
    const sampleId = Number(lastInsertRowid)
    for (const p of top) {
      insertProcess.run(
        sampleId,
        p.pid,
        p.ppid,
        p.name,
        p.cpu_usage,
        p.memory_bytes,
        p.status,
        p.user,
        p.command,
        p.threads ?? null,
        p.runtime_secs,
        p.disk_read_bytes,
        p.disk_write_bytes,
      )
    }
    const cutoff = new Date(Date.parse(at) - opts.retentionDays * 86_400_000).toISOString()
    // .changes would include FK-cascaded process rows — count samples explicitly
    const pruned = (
      db.prepare('SELECT COUNT(*) AS n FROM system_samples WHERE at < ?').get(cutoff) as {
        n: number
      }
    ).n
    db.prepare('DELETE FROM system_samples WHERE at < ?').run(cutoff)
    return { sampleId, processesStored: top.length, pruned }
  })
  return run()
}

export interface HistoryRow {
  id: number
  at: string
  cpu_usage_total: number
  memory_used: number
  memory_total: number
  load_1: number
  network_rx_bytes: number
  network_tx_bytes: number
  process_count: number
  swap_total_bytes?: number
  swap_used_bytes?: number
  battery_charge_percent?: number
  battery_charging?: boolean
  psi_cpu_some_avg10?: number
  psi_io_some_avg10?: number
  psi_memory_some_avg10?: number
  memory_pressure_level?: string
  cpu_power_watts?: number
  gpu_power_watts?: number
  ane_power_watts?: number
  dram_power_watts?: number
}

interface HistorySqlRow {
  id: number
  at: string
  cpu_usage_total: number
  memory_used: number
  memory_total: number
  load_1: number
  network_rx_bytes: number
  network_tx_bytes: number
  process_count: number
  swap_total_bytes: number | null
  swap_used_bytes: number | null
  battery_charge_percent: number | null
  battery_charging: number | null
  psi_cpu_some_avg10: number | null
  psi_io_some_avg10: number | null
  psi_memory_some_avg10: number | null
  memory_pressure_level: string | null
  cpu_power_watts: number | null
  gpu_power_watts: number | null
  ane_power_watts: number | null
  dram_power_watts: number | null
}

function historyRow(row: HistorySqlRow): HistoryRow {
  const out: HistoryRow = {
    id: row.id,
    at: row.at,
    cpu_usage_total: row.cpu_usage_total,
    memory_used: row.memory_used,
    memory_total: row.memory_total,
    load_1: row.load_1,
    network_rx_bytes: row.network_rx_bytes,
    network_tx_bytes: row.network_tx_bytes,
    process_count: row.process_count,
  }
  if (row.swap_total_bytes != null && row.swap_used_bytes != null) {
    out.swap_total_bytes = row.swap_total_bytes
    out.swap_used_bytes = row.swap_used_bytes
  }
  if (row.battery_charge_percent != null && row.battery_charging != null) {
    out.battery_charge_percent = row.battery_charge_percent
    out.battery_charging = row.battery_charging === 1
  }
  if (row.psi_cpu_some_avg10 != null) out.psi_cpu_some_avg10 = row.psi_cpu_some_avg10
  if (row.psi_io_some_avg10 != null) out.psi_io_some_avg10 = row.psi_io_some_avg10
  if (row.psi_memory_some_avg10 != null) out.psi_memory_some_avg10 = row.psi_memory_some_avg10
  if (row.memory_pressure_level != null) out.memory_pressure_level = row.memory_pressure_level
  if (row.cpu_power_watts != null) out.cpu_power_watts = row.cpu_power_watts
  if (row.gpu_power_watts != null) out.gpu_power_watts = row.gpu_power_watts
  if (row.ane_power_watts != null) out.ane_power_watts = row.ane_power_watts
  if (row.dram_power_watts != null) out.dram_power_watts = row.dram_power_watts
  return out
}

export function queryHistory(db: Database, sinceIso: string, limit: number): HistoryRow[] {
  const rows = db
    .prepare(
      `SELECT id, at, cpu_usage_total, memory_used, memory_total, load_1,
              network_rx_bytes, network_tx_bytes, process_count,
              swap_total_bytes, swap_used_bytes,
              battery_charge_percent, battery_charging,
              psi_cpu_some_avg10, psi_io_some_avg10, psi_memory_some_avg10,
              memory_pressure_level,
              cpu_power_watts, gpu_power_watts, ane_power_watts, dram_power_watts
       FROM system_samples WHERE at >= ? ORDER BY at DESC LIMIT ?`,
    )
    .all(sinceIso, limit) as HistorySqlRow[]
  return rows.map(historyRow)
}

export function queryTopProcesses(db: Database, sampleId: number): Record<string, unknown>[] {
  return db
    .prepare(
      `SELECT pid, name, cpu_usage, memory_bytes, user, command
       FROM process_samples WHERE sample_id = ? ORDER BY cpu_usage DESC`,
    )
    .all(sampleId) as Record<string, unknown>[]
}

export function dbInfo(db: Database): { samples: number; first?: string; last?: string } {
  const row = db
    .prepare('SELECT COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last FROM system_samples')
    .get() as { n: number; first: string | null; last: string | null }
  return { samples: row.n, ...(row.first ? { first: row.first } : {}), ...(row.last ? { last: row.last } : {}) }
}
