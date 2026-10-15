// macOS collector — port of monitor/*_darwin.go, using shell interfaces
// (ps, sysctl, vm_stat, netstat, df) instead of libproc/mach CGo.

import { execFileSync } from 'node:child_process'
import { cpus, hostname, release } from 'node:os'
import { basename } from 'node:path'
import * as ffi from './darwin_ffi.ts'
import { readEnergy } from './darwin_energy.ts'
import { parseIoregDisks } from './disk.ts'
import { parseAgxGpuTime, parseAgxPerformance } from './gpu.ts'
import type {
  CoreTicks,
  MemoryPressureLevel,
  PlatformSample,
  ProcessDetail,
  RawProc,
} from './types.ts'

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function sysctl(name: string): string {
  return sh('/usr/sbin/sysctl', ['-n', name]).trim()
}

const STATUS_MAP: Record<string, string> = {
  R: 'Running',
  S: 'Sleeping',
  I: 'Idle',
  T: 'Stopped',
  Z: 'Zombie',
  U: 'Waiting',
}

const SWAP_UNIT: Record<string, number> = {
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
}

/** `vm.swapusage` value, with or without the `vm.swapusage:` prefix. */
export function parseSwapUsage(text: string): { total: number; used: number } | null {
  const total = text.match(/total\s*=\s*([\d.]+)\s*([KMGT])?/i)
  const used = text.match(/used\s*=\s*([\d.]+)\s*([KMGT])?/i)
  if (!total || !used) return null
  const scale = (amount: string, unit: string | undefined) => {
    const n = Number(amount)
    if (!Number.isFinite(n)) return null
    const mult = unit ? SWAP_UNIT[unit.toUpperCase()] : 1
    if (!mult) return null
    return Math.round(n * mult)
  }
  const totalBytes = scale(total[1]!, total[2])
  const usedBytes = scale(used[1]!, used[2])
  if (totalBytes === null || usedBytes === null) return null
  return { total: totalBytes, used: usedBytes }
}

/**
 * `pmset -g batt`. No battery line → null (a desktop on AC is not 0%).
 * "not charging" is not charging.
 */
export function parsePmsetBatt(text: string): { chargePercent: number; charging: boolean } | null {
  const batteryLines = text.split('\n').filter((l) => /battery/i.test(l) && l.includes('%'))
  const line = batteryLines.find((l) => /internalbattery/i.test(l)) ?? batteryLines[0]
  if (!line) return null
  const m = line.match(/(\d+(?:\.\d+)?)%\s*;\s*([^;\n]+)/)
  if (!m) return null
  const chargePercent = Number(m[1])
  if (!Number.isFinite(chargePercent)) return null
  const status = m[2]!.trim().toLowerCase()
  return { chargePercent, charging: status === 'charging' || status === 'finishing charge' }
}

/** Parse ps etime ([[dd-]hh:]mm:ss) into seconds */
export function parseEtime(etime: string): number {
  const m = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/)
  if (!m) return 0
  const [, dd, hh, mm, ss] = m
  return (
    Number(dd ?? 0) * 86_400 + Number(hh ?? 0) * 3_600 + Number(mm ?? 0) * 60 + Number(ss ?? 0)
  )
}

function collectProcs(): RawProc[] {
  // Executable paths (comm) may contain spaces — fetch separately, pid-prefixed
  const commByPid = new Map<number, string>()
  for (const line of sh('/bin/ps', ['axo', 'pid=,comm=']).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/)
    if (m) commByPid.set(Number(m[1]), m[2]!)
  }

  const procs: RawProc[] = []
  for (const line of sh('/bin/ps', [
    'axo',
    'pid=,ppid=,pcpu=,rss=,state=,user=,etime=,args=',
  ]).split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 8) continue
    const [pid, ppid, pcpu, rss, state, user, etime] = parts
    const command = parts.slice(7).join(' ')
    const comm = commByPid.get(Number(pid)) ?? command
    const proc: RawProc = {
      pid: Number(pid),
      ppid: Number(ppid),
      name: basename(comm),
      cpuPct: Number(pcpu),
      memoryBytes: Number(rss) * 1024,
      status: STATUS_MAP[state?.[0] ?? ''] ?? 'Unknown',
      user: user!,
      command,
      runtimeSecs: parseEtime(etime!),
    }
    // libproc enrichment — threads/vsize/disk I/O (fails silently for
    // other users' processes without root, matching the Go port)
    const ti = ffi.taskInfo(proc.pid)
    if (ti) {
      proc.threads = ti.threadCount
      proc.vsizeBytes = ti.virtualSize
    }
    const io = ffi.diskIO(proc.pid)
    if (io) {
      proc.diskReadTotal = io.read
      proc.diskWriteTotal = io.write
      if (io.footprint !== undefined) proc.physFootprintBytes = io.footprint
    }
    procs.push(proc)
  }
  return procs
}

export function detail(pid: number): ProcessDetail {
  const cwd = ffi.cwd(pid)
  return { ...(cwd ? { cwd } : {}), environ: ffi.environ(pid) }
}

function collectMemory(total: number): { used: number; free: number } {
  const pageSize = Number(sysctl('hw.pagesize'))
  const counts: Record<string, number> = {}
  for (const line of sh('/usr/bin/vm_stat', []).split('\n')) {
    const m = line.match(/^(.+):\s+(\d+)\.$/)
    if (m) counts[m[1]!.trim()] = Number(m[2])
  }
  const used =
    ((counts['Pages active'] ?? 0) +
      (counts['Pages wired down'] ?? 0) +
      (counts['Pages occupied by compressor'] ?? 0)) *
    pageSize
  return { used, free: total - used }
}

function collectNet(): { rx: number; tx: number } {
  const lines = sh('/usr/sbin/netstat', ['-ibn']).split('\n')
  const header = lines[0]?.trim().split(/\s+/) ?? []
  const addressIdx = header.indexOf('Address')
  const ibytesIdx = header.indexOf('Ibytes')
  const obytesIdx = header.indexOf('Obytes')
  let rx = 0
  let tx = 0
  const seen = new Set<string>()
  for (const line of lines.slice(1)) {
    if (!line.includes('<Link#')) continue
    const parts = line.trim().split(/\s+/)
    const iface = parts[0]!
    if (iface.startsWith('lo') || seen.has(iface)) continue
    seen.add(iface)
    // Link rows without a MAC address shift columns after Address left by the gap
    const shift = parts.length < header.length ? header.length - parts.length : 0
    const at = (idx: number) => Number(parts[idx > addressIdx ? idx - shift : idx] ?? 0)
    rx += at(ibytesIdx)
    tx += at(obytesIdx)
  }
  return { rx, tx }
}

// Bun's node:os polyfill surfaces real host_processor_info tick counters,
// so per-core CPU% comes from os.cpus() deltas — no mach FFI needed.
function collectCoreTicks(): CoreTicks[] {
  return cpus().map((core) => {
    const t = core.times
    const total = t.user + t.nice + t.sys + t.idle + t.irq
    return { busy: total - t.idle, total }
  })
}

function collectSwap(): { total: number; used: number } | undefined {
  try {
    return parseSwapUsage(sysctl('vm.swapusage')) ?? undefined
  } catch {
    return
  }
}

/**
 * `sysctl -n kern.memorystatus_vm_pressure_level` returns the userspace
 * note (NOTE_MEMORYSTATUS_PRESSURE_*), not the internal enum. 1 is normal.
 */
export function parseMemoryPressureLevel(text: string): MemoryPressureLevel | null {
  switch (Number(text.trim())) {
    case 1:
      return 'normal'
    case 2:
      return 'warning'
    case 4:
      return 'critical'
    default:
      return null
  }
}

function collectMemoryPressure(): MemoryPressureLevel | undefined {
  try {
    return parseMemoryPressureLevel(sysctl('kern.memorystatus_vm_pressure_level')) ?? undefined
  } catch {
    return
  }
}

function collectBattery(): { chargePercent: number; charging: boolean } | undefined {
  try {
    return parsePmsetBatt(sh('/usr/bin/pmset', ['-g', 'batt'])) ?? undefined
  } catch {
    return
  }
}

function collectGpuTime() {
  try {
    const text = sh('/usr/sbin/ioreg', ['-r', '-c', 'AGXDeviceUserClient', '-d', '0'])
    const gpuTimeNs = parseAgxGpuTime(text)
    return gpuTimeNs.size > 0 ? gpuTimeNs : undefined
  } catch {
    return
  }
}

/** Separate from GPU time so a missing accelerator does not drop `gpu_time_ms`. */
function collectGpuActivity() {
  try {
    const text = sh('/usr/sbin/ioreg', ['-r', '-c', 'AGXAccelerator', '-d', '0'])
    return parseAgxPerformance(text)
  } catch {
    return
  }
}

function collectDiskCounters() {
  try {
    // Depth-limited ioreg. The full `-l` tree is slow and is not required.
    // No Full Disk Access: the hourly recorder can store this rollup.
    const drivers = sh('/usr/sbin/ioreg', ['-r', '-c', 'IOBlockStorageDriver', '-d', '2'])
    const media = sh('/usr/sbin/ioreg', ['-r', '-c', 'IOMedia', '-d', '0'])
    const disks = parseIoregDisks(drivers, media)
    return disks.length > 0 ? disks : undefined
  } catch {
    return
  }
}

function collectDisk(): { total: number; used: number; free: number } {
  const line = sh('/bin/df', ['-k', '/']).split('\n')[1]
  const parts = line?.trim().split(/\s+/) ?? []
  return {
    total: Number(parts[1] ?? 0) * 1024,
    used: Number(parts[2] ?? 0) * 1024,
    free: Number(parts[3] ?? 0) * 1024,
  }
}

export function collect(): PlatformSample {
  const memoryTotal = Number(sysctl('hw.memsize'))
  const { used, free } = collectMemory(memoryTotal)
  const net = collectNet()
  const disk = collectDisk()
  const disks = collectDiskCounters()
  const gpuTimeNs = collectGpuTime()
  const gpuActivity = collectGpuActivity()
  const swap = collectSwap()
  const battery = collectBattery()
  const memoryPressureLevel = collectMemoryPressure()
  const energyNj = readEnergy()

  const bootMatch = sysctl('kern.boottime').match(/sec = (\d+)/)
  const uptimeSecs = bootMatch ? Math.floor(Date.now() / 1000) - Number(bootMatch[1]) : 0

  const loadParts = sysctl('vm.loadavg').replace(/[{}]/g, '').trim().split(/\s+/)
  const loadAvg: [number, number, number] = [
    Number(loadParts[0] ?? 0),
    Number(loadParts[1] ?? 0),
    Number(loadParts[2] ?? 0),
  ]

  return {
    cpuBrand: sysctl('machdep.cpu.brand_string'),
    coreCount: Number(sysctl('hw.ncpu')),
    cpuPerCoreTicks: collectCoreTicks(),
    memoryTotal,
    memoryUsed: used,
    memoryFree: free,
    netRxTotal: net.rx,
    netTxTotal: net.tx,
    diskTotal: disk.total,
    diskUsed: disk.used,
    diskFree: disk.free,
    uptimeSecs,
    loadAvg,
    hostname: hostname(),
    osVersion: `macOS ${sh('/usr/bin/sw_vers', ['-productVersion']).trim()}`,
    kernelVersion: `Darwin ${release()}`,
    procs: collectProcs(),
    ...(swap ? { swapTotal: swap.total, swapUsed: swap.used } : {}),
    ...(battery
      ? { batteryChargePercent: battery.chargePercent, batteryCharging: battery.charging }
      : {}),
    ...(memoryPressureLevel ? { memoryPressureLevel } : {}),
    ...(energyNj ? { energyNj } : {}),
    ...(disks ? { disks } : {}),
    ...(gpuTimeNs ? { gpuTimeNs } : {}),
    ...(gpuActivity ? { gpuActivity } : {}),
  }
}
