// macOS collector — port of monitor/*_darwin.go, using shell interfaces
// (ps, sysctl, vm_stat, netstat, df) instead of libproc/mach CGo.

import { execFileSync } from 'node:child_process'
import { cpus, hostname, release } from 'node:os'
import { basename } from 'node:path'
import type { CoreTicks, PlatformSample, RawProc } from './types.ts'

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
    procs.push({
      pid: Number(pid),
      ppid: Number(ppid),
      name: basename(comm),
      cpuPct: Number(pcpu),
      memoryBytes: Number(rss) * 1024,
      status: STATUS_MAP[state?.[0] ?? ''] ?? 'Unknown',
      user: user!,
      command,
      runtimeSecs: parseEtime(etime!),
    })
  }
  return procs
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
  }
}
