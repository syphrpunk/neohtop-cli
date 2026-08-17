// Monitor — port of monitor/monitor.go. Holds previous counters and turns
// cumulative platform samples into rates and percentages.

import { platform } from 'node:os'
import type { PlatformSample, ProcessDetail, ProcessInfo, SystemStats } from './types.ts'

const CLK_TCK = 100

interface PrevSample {
  at: number // ms
  netRx: number
  netTx: number
  coreTicks?: { busy: number; total: number }[]
  procTicks: Map<number, number>
  procDisk: Map<number, { read: number; write: number }>
}

interface PlatformImpl {
  collect: () => PlatformSample
  detail: (pid: number) => ProcessDetail
}

async function loadPlatform(): Promise<PlatformImpl> {
  switch (platform()) {
    case 'darwin':
      return import('./darwin.ts')
    case 'linux':
      return import('./linux.ts')
    case 'win32':
      return import('./windows.ts')
    default:
      throw new Error(`unsupported platform: ${platform()}`)
  }
}

export class Monitor {
  #impl!: PlatformImpl
  #prev: PrevSample | null = null
  #sample: PlatformSample | null = null
  #cpuPerCore: number[] = []
  #netRxRate = 0
  #netTxRate = 0
  #procCpu = new Map<number, number>()
  #procDiskRate = new Map<number, { read: number; write: number }>()

  static async create(): Promise<Monitor> {
    const m = new Monitor()
    m.#impl = await loadPlatform()
    return m
  }

  refresh(): void {
    const sample = this.#impl.collect()
    const at = Date.now()
    const prev = this.#prev
    const elapsed = prev ? (at - prev.at) / 1000 : 0

    // Network rates (bytes/s) from cumulative counter deltas
    if (prev && elapsed > 0) {
      this.#netRxRate = Math.max(0, (sample.netRxTotal - prev.netRx) / elapsed)
      this.#netTxRate = Math.max(0, (sample.netTxTotal - prev.netTx) / elapsed)
    }

    // Per-core CPU% from tick deltas (Linux)
    if (sample.cpuPerCoreTicks) {
      this.#cpuPerCore = sample.cpuPerCoreTicks.map((core, i) => {
        const p = prev?.coreTicks?.[i]
        if (!p || core.total <= p.total) return 0
        return Math.min(100, ((core.busy - p.busy) / (core.total - p.total)) * 100)
      })
    }

    // Per-process disk I/O rates from cumulative counter deltas
    this.#procDiskRate.clear()
    const procDisk = new Map<number, { read: number; write: number }>()
    for (const proc of sample.procs) {
      if (proc.diskReadTotal === undefined && proc.diskWriteTotal === undefined) continue
      const cur = { read: proc.diskReadTotal ?? 0, write: proc.diskWriteTotal ?? 0 }
      procDisk.set(proc.pid, cur)
      const p = prev?.procDisk.get(proc.pid)
      if (p && elapsed > 0) {
        this.#procDiskRate.set(proc.pid, {
          read: Math.max(0, (cur.read - p.read) / elapsed),
          write: Math.max(0, (cur.write - p.write) / elapsed),
        })
      }
    }

    // Per-process CPU%
    this.#procCpu.clear()
    const procTicks = new Map<number, number>()
    for (const proc of sample.procs) {
      if (proc.cpuPct !== undefined) {
        // macOS: ps pcpu is ready-made
        this.#procCpu.set(proc.pid, proc.cpuPct)
      } else if (proc.cpuTicks !== undefined) {
        procTicks.set(proc.pid, proc.cpuTicks)
        const prevTicks = prev?.procTicks.get(proc.pid)
        if (prevTicks !== undefined && elapsed > 0) {
          // delta-based between refreshes
          const pct = ((proc.cpuTicks - prevTicks) / CLK_TCK / elapsed) * 100
          this.#procCpu.set(proc.pid, Math.max(0, pct))
        } else {
          // first sight: average since process start
          const avg =
            proc.runtimeSecs > 0 ? (proc.cpuTicks / CLK_TCK / proc.runtimeSecs) * 100 : 0
          this.#procCpu.set(proc.pid, avg)
        }
      }
    }

    this.#prev = {
      at,
      netRx: sample.netRxTotal,
      netTx: sample.netTxTotal,
      coreTicks: sample.cpuPerCoreTicks,
      procTicks,
      procDisk,
    }
    this.#sample = sample
  }

  detail(pid: number): ProcessDetail {
    return this.#impl.detail(pid)
  }

  stats(): SystemStats {
    const s = this.#sample
    if (!s) throw new Error('refresh() must be called before stats()')
    const perCore = this.#cpuPerCore
    let total: number
    if (perCore.length > 0) {
      total = perCore.reduce((a, b) => a + b, 0) / perCore.length
    } else {
      // macOS: aggregate of per-process ps pcpu, normalized by core count
      let sum = 0
      for (const pct of this.#procCpu.values()) sum += pct
      total = Math.min(100, sum / s.coreCount)
    }
    return {
      cpu_brand: s.cpuBrand,
      cpu_usage_per_core: perCore.map((v) => round1(v)),
      cpu_usage_total: round1(total),
      core_count: s.coreCount,
      memory_total: s.memoryTotal,
      memory_used: s.memoryUsed,
      memory_free: s.memoryFree,
      uptime_secs: s.uptimeSecs,
      load_avg: s.loadAvg,
      network_rx_bytes: Math.round(this.#netRxRate),
      network_tx_bytes: Math.round(this.#netTxRate),
      disk_total_bytes: s.diskTotal,
      disk_used_bytes: s.diskUsed,
      disk_free_bytes: s.diskFree,
      hostname: s.hostname,
      os_version: s.osVersion,
      kernel_version: s.kernelVersion,
      process_count: s.procs.length,
    }
  }

  processes(): ProcessInfo[] {
    const s = this.#sample
    if (!s) throw new Error('refresh() must be called before processes()')
    return s.procs.map((p) => {
      const disk = this.#procDiskRate.get(p.pid)
      return {
        pid: p.pid,
        ppid: p.ppid,
        name: p.name,
        cpu_usage: round1(this.#procCpu.get(p.pid) ?? 0),
        memory_bytes: p.memoryBytes,
        status: p.status,
        user: p.user,
        command: p.command,
        ...(p.threads !== undefined ? { threads: p.threads } : {}),
        runtime_secs: p.runtimeSecs,
        ...(p.vsizeBytes !== undefined ? { virtual_memory_bytes: p.vsizeBytes } : {}),
        disk_read_bytes: Math.round(disk?.read ?? 0),
        disk_write_bytes: Math.round(disk?.write ?? 0),
      }
    })
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * One-shot snapshot. Samples twice `sampleMs` apart so delta-based metrics
 * (Linux CPU%, network rates) are real instead of zero.
 */
export async function snapshot(sampleMs = 500): Promise<{
  system: SystemStats
  processes: ProcessInfo[]
}> {
  const mon = await Monitor.create()
  mon.refresh()
  await sleep(sampleMs)
  mon.refresh()
  return { system: mon.stats(), processes: mon.processes() }
}

/** On-demand expensive fields (cwd, environ) — port of getProcessDetail */
export async function processDetail(pid: number): Promise<ProcessDetail> {
  const impl = await loadPlatform()
  return impl.detail(pid)
}

export { sleep }
export type { ProcessDetail, ProcessInfo, SystemStats } from './types.ts'
