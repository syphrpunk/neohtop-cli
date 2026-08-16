// Linux collector — port of monitor/*_linux.go, reading /proc directly.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { hostname, release } from 'node:os'
import type { CoreTicks, PlatformSample, ProcessDetail, RawProc } from './types.ts'

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
      procs.push(proc)
    } catch {
      // process exited mid-scan
    }
  }
  return procs
}

function collectMem(): { total: number; used: number; free: number } {
  const kv: Record<string, number> = {}
  for (const line of readProc('meminfo').split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+) kB/)
    if (m) kv[m[1]!] = Number(m[2]) * 1024
  }
  const total = kv['MemTotal'] ?? 0
  const available = kv['MemAvailable'] ?? kv['MemFree'] ?? 0
  return { total, used: total - available, free: kv['MemFree'] ?? 0 }
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

export function collect(): PlatformSample {
  const uptimeSecs = Math.floor(Number(readProc('uptime').split(' ')[0]))
  const load = readProc('loadavg').trim().split(/\s+/)
  const mem = collectMem()
  const net = collectNet()
  const disk = collectDisk()
  const cores = collectCoreTicks()

  return {
    cpuBrand: cpuBrand(),
    coreCount: cores.length,
    cpuPerCoreTicks: cores,
    memoryTotal: mem.total,
    memoryUsed: mem.used,
    memoryFree: mem.free,
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
