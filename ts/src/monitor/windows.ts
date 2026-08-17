// Windows collector — port of monitor/*_windows.go. One PowerShell CIM
// query per refresh returns everything as JSON; per-core CPU comes from
// os.cpus() tick counters (same native-bun approach as darwin.ts).
//
// Notes vs the other platforms:
// - No load average on Windows → [0, 0, 0]
// - Process owner lookup (GetOwner) is a per-process CIM method call and
//   far too slow for a full listing → user is ''
// - Win32_Process exposes no scheduler state → status is 'Running'
// - KernelModeTime/UserModeTime are 100ns units → converted to 10ms ticks
//   so Monitor's CLK_TCK=100 delta math applies unchanged

import { execFileSync } from 'node:child_process'
import { cpus, hostname } from 'node:os'
import type { CoreTicks, PlatformSample, ProcessDetail, RawProc } from './types.ts'

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$now = Get-Date
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object Size,FreeSpace)
$net = @(Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface | Select-Object BytesReceivedPersec,BytesSentPersec)
$procs = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,VirtualSize,ThreadCount,CommandLine,KernelModeTime,UserModeTime,ReadTransferCount,WriteTransferCount,@{n='RuntimeSecs';e={ if ($_.CreationDate) { [int](($now - $_.CreationDate).TotalSeconds) } else { 0 } }})
@{
  cpuBrand = $cpu.Name
  memoryTotalKb = $os.TotalVisibleMemorySize
  memoryFreeKb = $os.FreePhysicalMemory
  osCaption = $os.Caption
  osVersion = $os.Version
  uptimeSecs = [int](($now - $os.LastBootUpTime).TotalSeconds)
  disks = $disks
  net = $net
  procs = $procs
} | ConvertTo-Json -Depth 4 -Compress
`

interface RawWindows {
  cpuBrand?: string
  memoryTotalKb?: number
  memoryFreeKb?: number
  osCaption?: string
  osVersion?: string
  uptimeSecs?: number
  disks?: { Size?: number; FreeSpace?: number }[]
  net?: { BytesReceivedPersec?: number; BytesSentPersec?: number }[]
  procs?: {
    ProcessId?: number
    ParentProcessId?: number
    Name?: string
    WorkingSetSize?: number
    VirtualSize?: number
    ThreadCount?: number
    CommandLine?: string | null
    KernelModeTime?: number
    UserModeTime?: number
    ReadTransferCount?: number
    WriteTransferCount?: number
    RuntimeSecs?: number
  }[]
}

function psJson(): RawWindows {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  return JSON.parse(out) as RawWindows
}

export function collectCoreTicks(): CoreTicks[] {
  return cpus().map((c) => {
    const t = c.times
    const total = t.user + t.nice + t.sys + t.idle + t.irq
    return { busy: total - t.idle, total }
  })
}

/** Pure assembly from the PowerShell JSON — exported for tests. */
export function buildSample(raw: RawWindows, coreTicks: CoreTicks[], host: string): PlatformSample {
  const procs: RawProc[] = (raw.procs ?? []).flatMap((p) => {
    if (p.ProcessId === undefined) return []
    // 100ns units → 10ms ticks (CLK_TCK = 100)
    const ticks = ((p.KernelModeTime ?? 0) + (p.UserModeTime ?? 0)) / 100_000
    return [
      {
        pid: p.ProcessId,
        ppid: p.ParentProcessId ?? 0,
        name: p.Name ?? String(p.ProcessId),
        memoryBytes: p.WorkingSetSize ?? 0,
        status: 'Running',
        user: '',
        command: p.CommandLine ?? p.Name ?? '',
        ...(p.ThreadCount !== undefined ? { threads: p.ThreadCount } : {}),
        runtimeSecs: p.RuntimeSecs ?? 0,
        ...(p.VirtualSize !== undefined ? { vsizeBytes: p.VirtualSize } : {}),
        diskReadTotal: p.ReadTransferCount ?? 0,
        diskWriteTotal: p.WriteTransferCount ?? 0,
        cpuTicks: ticks,
      },
    ]
  })

  let diskTotal = 0
  let diskFree = 0
  for (const d of raw.disks ?? []) {
    diskTotal += d.Size ?? 0
    diskFree += d.FreeSpace ?? 0
  }
  let netRx = 0
  let netTx = 0
  for (const n of raw.net ?? []) {
    netRx += n.BytesReceivedPersec ?? 0 // PerfRawData: raw cumulative counter despite the name
    netTx += n.BytesSentPersec ?? 0
  }

  const memoryTotal = (raw.memoryTotalKb ?? 0) * 1024
  const memoryFree = (raw.memoryFreeKb ?? 0) * 1024
  return {
    cpuBrand: raw.cpuBrand ?? 'unknown',
    coreCount: coreTicks.length,
    cpuPerCoreTicks: coreTicks,
    memoryTotal,
    memoryUsed: memoryTotal - memoryFree,
    memoryFree,
    netRxTotal: netRx,
    netTxTotal: netTx,
    diskTotal,
    diskUsed: diskTotal - diskFree,
    diskFree,
    uptimeSecs: raw.uptimeSecs ?? 0,
    loadAvg: [0, 0, 0],
    hostname: host,
    osVersion: raw.osCaption ?? 'Windows',
    kernelVersion: raw.osVersion ?? '',
    procs,
  }
}

export function collect(): PlatformSample {
  return buildSample(psJson(), collectCoreTicks(), hostname())
}

/** cwd/environ have no cheap user-mode API on Windows — empty detail. */
export function detail(_pid: number): ProcessDetail {
  return {}
}
