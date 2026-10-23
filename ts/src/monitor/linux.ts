// Linux collector — port of monitor/*_linux.go, reading /proc directly.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { hostname, release } from 'node:os'
import { parseCgroupPath } from './cgroup.ts'
import { parseDiskstats } from './disk.ts'
import { memoryFromMeminfo, pagingFromVmstat } from './memory.ts'
import { flagOn, type CollectFlags } from './probes.ts'
import { parseGpuBusyPercent, parseGpuMemoryBytes, parseHwmonInput } from './sensors.ts'
import type { CoreTicks, FanReading, GpuActivity, PlatformSample, ProcessDetail, RawProc, TemperatureReading } from './types.ts'

const CLK_TCK = 100 // USER_HZ — 100 on every mainstream Linux
const PAGE_SIZE = 4096

function readProc(path: string): string {
  return readFileSync(`/proc/${path}`, 'utf8')
}

const STATUS_MAP: Record<string, string> = {
  R: 'Running',
  S: 'Sleeping',
  D: 'Waiting',
  I: 'Idle',
  T: 'Stopped',
  t: 'Stopped',
  Z: 'Zombie',
  X: 'Dead',
}

function collectCoreTicks(): CoreTicks[] {
  const cores: CoreTicks[] = []
  for (const line of readProc('stat').split('\n')) {
    if (!/^cpu\d+ /.test(line)) continue
    // cpu<N> user nice system idle iowait irq softirq steal
    const f = line.trim().split(/\s+/).slice(1).map(Number)
    const total = f.reduce((a, b) => a + (b || 0), 0)
    const idle = (f[3] ?? 0) + (f[4] ?? 0)
    cores.push({ busy: total - idle, total })
  }
  return cores
}

function userMap(): Map<number, string> {
  const map = new Map<number, string>()
  try {
    for (const line of readFileSync('/etc/passwd', 'utf8').split('\n')) {
      const parts = line.split(':')
      if (parts.length >= 3) map.set(Number(parts[2]), parts[0]!)
    }
  } catch {
    // fall through — uid used as name
  }
  return map
}

function collectProcs(uptimeSecs: number): RawProc[] {
  const users = userMap()
  const procs: RawProc[] = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const stat = readProc(`${entry}/stat`)
      // comm may contain spaces/parens — split around the last ')'
      const close = stat.lastIndexOf(')')
      const comm = stat.slice(stat.indexOf('(') + 1, close)
      const f = stat.slice(close + 2).trim().split(/\s+/)
      // post-comm indices: 0=state 1=ppid 11=utime 12=stime 17=num_threads 19=starttime 21=rss
      const utime = Number(f[11] ?? 0)
      const stime = Number(f[12] ?? 0)
      const startTicks = Number(f[19] ?? 0)

      let user = ''
      const uidLine = readProc(`${entry}/status`).match(/^Uid:\s+(\d+)/m)
      if (uidLine) {
        const uid = Number(uidLine[1])
        user = users.get(uid) ?? String(uid)
      }

      const cmdline = readProc(`${entry}/cmdline`).replace(/\0+$/, '').replaceAll('\0', ' ')

      const proc: RawProc = {
        pid: Number(entry),
        ppid: Number(f[1] ?? 0),
        name: comm,
        memoryBytes: Number(f[21] ?? 0) * PAGE_SIZE,
        status: STATUS_MAP[f[0] ?? ''] ?? 'Unknown',
        user,
        command: cmdline || `[${comm}]`,
        threads: Number(f[17] ?? 0) || undefined,
        runtimeSecs: Math.max(0, Math.floor(uptimeSecs - startTicks / CLK_TCK)),
        vsizeBytes: Number(f[20] ?? 0),
        cpuTicks: utime + stime,
      }
      try {
        // /proc/[pid]/io needs same-user (or root) — cumulative byte counters
        const io = readProc(`${entry}/io`)
        const read = io.match(/^read_bytes: (\d+)/m)
        const write = io.match(/^write_bytes: (\d+)/m)
        if (read) proc.diskReadTotal = Number(read[1])
        if (write) proc.diskWriteTotal = Number(write[1])
      } catch {
        // permission denied — leave undefined
      }
      try {
        const cgroup = parseCgroupPath(readProc(`${entry}/cgroup`))
        if (cgroup !== undefined) proc.cgroup = cgroup
      } catch {
        // exited, or /proc has no cgroup file
      }
      procs.push(proc)
    } catch {
      // process exited mid-scan
    }
  }
  return procs
}

/** SwapTotal/SwapFree from `/proc/meminfo`. Missing keys → null, not zero. */
export function parseMeminfoSwap(text: string): { total: number; used: number } | null {
  const total = text.match(/^SwapTotal:\s+(\d+)\s+kB/m)
  const free = text.match(/^SwapFree:\s+(\d+)\s+kB/m)
  if (!total || !free) return null
  const totalBytes = Number(total[1]) * 1024
  const freeBytes = Number(free[1]) * 1024
  return { total: totalBytes, used: Math.max(0, totalBytes - freeBytes) }
}

/** First `some avg10=` in a `/proc/pressure/*` file. Missing file is the caller's problem. */
export function parsePsiSomeAvg10(text: string): number | null {
  const m = text.match(/^some\s+avg10=(\d+(?:\.\d+)?)/m)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** `capacity` and `status` from `/sys/class/power_supply/BAT*`. */
export function parseLinuxBattery(
  capacity: string,
  status: string,
): { chargePercent: number; charging: boolean } | null {
  const chargePercent = Number(capacity.trim())
  if (!Number.isFinite(chargePercent)) return null
  return { chargePercent, charging: status.trim().toLowerCase() === 'charging' }
}

function collectMem() {
  return memoryFromMeminfo(readProc('meminfo'))
}

function collectPaging() {
  try {
    const pages = pagingFromVmstat(readProc('vmstat'), PAGE_SIZE)
    return hasCounter(pages) ? pages : undefined
  } catch {
    return
  }
}

function hasCounter(pages: {
  pageins?: number
  pageouts?: number
  compressions?: number
  decompressions?: number
}): boolean {
  return (
    pages.pageins !== undefined ||
    pages.pageouts !== undefined ||
    pages.compressions !== undefined ||
    pages.decompressions !== undefined
  )
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return
  }
}

/** `/sys/class/hwmon` temperatures are millidegrees. Fan inputs are rpm. */
function collectHwmon(): { temperatures?: TemperatureReading[]; fans?: FanReading[] } {
  const root = '/sys/class/hwmon'
  if (!existsSync(root)) return {}
  const temperatures: TemperatureReading[] = []
  const fans: FanReading[] = []
  let dirs: string[]
  try {
    dirs = readdirSync(root)
  } catch {
    return {}
  }
  for (const dir of dirs.sort()) {
    if (!/^hwmon\d+$/.test(dir)) continue
    const base = `${root}/${dir}`
    const chip = readText(`${base}/name`)?.trim() || dir
    let files: string[]
    try {
      files = readdirSync(base)
    } catch {
      continue
    }
    for (const file of files) {
      if (!/^(?:temp|fan)\d+_input$/.test(file)) continue
      const input = readText(`${base}/${file}`)
      if (input === undefined) continue
      const label = readText(`${base}/${file.replace(/_input$/, '_label')}`)
      const parsed = parseHwmonInput({ chip, key: file, input, ...(label !== undefined ? { label } : {}) })
      if (!parsed) continue
      if (parsed.kind === 'temp') temperatures.push(parsed.reading)
      else fans.push(parsed.reading)
    }
  }
  return {
    ...(temperatures.length > 0 ? { temperatures } : {}),
    ...(fans.length > 0 ? { fans } : {}),
  }
}

/**
 * First DRM card that publishes a busy percent or VRAM-used file.
 * No NVML. Per-process VRAM is not read.
 */
function collectDrm(): GpuActivity | undefined {
  const root = '/sys/class/drm'
  if (!existsSync(root)) return
  let cards: string[]
  try {
    cards = readdirSync(root)
      .filter((name) => /^card\d+$/.test(name))
      .sort()
  } catch {
    return
  }
  for (const card of cards) {
    const dev = `${root}/${card}/device`
    const busy = parseMaybe(readText(`${dev}/gpu_busy_percent`), parseGpuBusyPercent)
    const memory = parseMaybe(readText(`${dev}/mem_info_vram_used`), parseGpuMemoryBytes)
    if (busy === undefined && memory === undefined) continue
    return {
      ...(busy !== undefined ? { devicePercent: busy } : {}),
      ...(memory !== undefined ? { memoryBytes: memory } : {}),
    }
  }
  return
}

function parseMaybe<T>(text: string | undefined, parse: (value: string) => T | null): T | undefined {
  if (text === undefined) return
  const parsed = parse(text)
  return parsed === null ? undefined : parsed
}

function collectNet(): { rx: number; tx: number } {
  let rx = 0
  let tx = 0
  for (const line of readProc('net/dev').split('\n').slice(2)) {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/)
    if (!m || m[1] === 'lo') continue
    const f = m[2]!.trim().split(/\s+/)
    rx += Number(f[0] ?? 0)
    tx += Number(f[8] ?? 0)
  }
  return { rx, tx }
}

function collectSwap(): { total: number; used: number } | undefined {
  try {
    return parseMeminfoSwap(readProc('meminfo')) ?? undefined
  } catch {
    return
  }
}

function collectPsi(kind: 'cpu' | 'io' | 'memory'): number | undefined {
  try {
    return parsePsiSomeAvg10(readProc(`pressure/${kind}`)) ?? undefined
  } catch {
    return
  }
}

function collectBattery(): { chargePercent: number; charging: boolean } | undefined {
  try {
    const dir = '/sys/class/power_supply'
    if (!existsSync(dir)) return
    const bats = readdirSync(dir)
      .filter((n) => /^BAT\d+$/.test(n))
      .sort()
    const bat = bats[0]
    if (!bat) return
    const parsed = parseLinuxBattery(
      readFileSync(`${dir}/${bat}/capacity`, 'utf8'),
      readFileSync(`${dir}/${bat}/status`, 'utf8'),
    )
    return parsed ?? undefined
  } catch {
    return
  }
}

function collectDiskCounters() {
  try {
    const disks = parseDiskstats(readProc('diskstats'))
    return disks.length > 0 ? disks : undefined
  } catch {
    return
  }
}

function collectDisk(): { total: number; used: number; free: number } {
  const line = execFileSync('df', ['-k', '/'], { encoding: 'utf8' }).split('\n')[1]
  const parts = line?.trim().split(/\s+/) ?? []
  return {
    total: Number(parts[1] ?? 0) * 1024,
    used: Number(parts[2] ?? 0) * 1024,
    free: Number(parts[3] ?? 0) * 1024,
  }
}

function osVersion(): string {
  try {
    const m = readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)"?/m)
    if (m) return m[1]!
  } catch {
    // fall through
  }
  return `Linux ${release()}`
}

function cpuBrand(): string {
  const m = readProc('cpuinfo').match(/^model name\s*:\s*(.+)$/m)
  return m ? m[1]! : 'Unknown CPU'
}

export function collect(flags?: CollectFlags): PlatformSample {
  const uptimeSecs = Math.floor(Number(readProc('uptime').split(' ')[0]))
  const load = readProc('loadavg').trim().split(/\s+/)
  const mem = collectMem()
  const net = collectNet()
  const disk = collectDisk()
  const disks = flagOn(flags, 'diskDevices') ? collectDiskCounters() : undefined
  const cores = collectCoreTicks()
  const swap = flagOn(flags, 'swap') ? collectSwap() : undefined
  const battery = flagOn(flags, 'battery') ? collectBattery() : undefined
  const psiCpu = flagOn(flags, 'pressure') ? collectPsi('cpu') : undefined
  const psiIo = flagOn(flags, 'pressure') ? collectPsi('io') : undefined
  const psiMemory = flagOn(flags, 'pressure') ? collectPsi('memory') : undefined
  const pages = collectPaging()
  const sensors = flagOn(flags, 'sensors') ? collectHwmon() : {}
  const gpuActivity = flagOn(flags, 'gpu') ? collectDrm() : undefined

  return {
    cpuBrand: cpuBrand(),
    coreCount: cores.length,
    cpuPerCoreTicks: cores,
    memoryTotal: mem.total,
    memoryUsed: mem.used,
    memoryFree: mem.free,
    ...(mem.app !== undefined ? { memoryApp: mem.app } : {}),
    ...(mem.cached !== undefined ? { memoryCached: mem.cached } : {}),
    ...(mem.compressed !== undefined ? { memoryCompressed: mem.compressed } : {}),
    ...(pages ? { pageCounters: pages } : {}),
    netRxTotal: net.rx,
    netTxTotal: net.tx,
    diskTotal: disk.total,
    diskUsed: disk.used,
    diskFree: disk.free,
    uptimeSecs,
    loadAvg: [Number(load[0] ?? 0), Number(load[1] ?? 0), Number(load[2] ?? 0)],
    hostname: hostname(),
    osVersion: osVersion(),
    kernelVersion: release(),
    procs: collectProcs(uptimeSecs),
    ...(swap ? { swapTotal: swap.total, swapUsed: swap.used } : {}),
    ...(battery
      ? { batteryChargePercent: battery.chargePercent, batteryCharging: battery.charging }
      : {}),
    ...(psiCpu !== undefined ? { psiCpuSomeAvg10: psiCpu } : {}),
    ...(psiIo !== undefined ? { psiIoSomeAvg10: psiIo } : {}),
    ...(psiMemory !== undefined ? { psiMemorySomeAvg10: psiMemory } : {}),
    ...(disks ? { disks } : {}),
    ...(sensors.temperatures ? { temperatures: sensors.temperatures } : {}),
    ...(sensors.fans ? { fans: sensors.fans } : {}),
    ...(gpuActivity ? { gpuActivity } : {}),
  }
}

export function isSupported(): boolean {
  return existsSync('/proc/stat')
}

export function detail(pid: number): ProcessDetail {
  const out: ProcessDetail = {}
  try {
    out.cwd = readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    // permission denied
  }
  try {
    out.environ = readProc(`${pid}/environ`)
      .split('\0')
      .filter((s) => s.includes('='))
  } catch {
    out.environ = []
  }
  return out
}
