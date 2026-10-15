// Per-connection byte rates. macOS reads `netstat -anv` counters. Linux reads
// `ss -i` byte counters. Neither path escalates privileges. Windows has no
// unprivileged per-connection byte counter here, so `net` errors instead of
// pretending the table is empty.

import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'

export class NetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetError'
  }
}

export interface NetSample {
  proto: string
  local: string
  remote: string
  state?: string
  pid: number
  name: string
  rxBytes: number
  txBytes: number
}

export interface NetRow {
  proto: string
  local: string
  remote: string
  state?: string
  pid: number
  name: string
  rx_bytes_per_s: number
  tx_bytes_per_s: number
}

const DARWIN_ROW =
  /^(tcp4|tcp6|udp4|udp6|udp46)\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s+(?:([A-Z_]+)\s+)?(\d+)\s+(\d+)\s+\d+\s+\d+\s+(.+):(\d+)\s+[0-9a-fA-F]{5}\b/

/** Rows from `netstat -anv`. Lines that are not connection counters are skipped. */
export function parseDarwinNetstat(text: string): NetSample[] {
  const out: NetSample[] = []
  for (const line of text.split('\n')) {
    const m = DARWIN_ROW.exec(line.trim())
    if (!m) continue
    const pid = Number(m[8])
    if (!Number.isInteger(pid)) continue
    out.push({
      proto: m[1]!,
      local: m[2]!,
      remote: m[3]!,
      ...(m[4] ? { state: m[4] } : {}),
      rxBytes: Number(m[5]),
      txBytes: Number(m[6]),
      name: m[7]!.trim(),
      pid,
    })
  }
  return out
}

export function darwinNetstatOk(text: string): boolean {
  return text.includes('rxbytes') && text.includes('process:pid')
}

/**
 * One `ss -H -i` protocol dump. `proto` is tagged by the caller because ss
 * does not print tcp versus udp on the row. Unattributed sockets are skipped.
 */
export function parseSs(text: string, proto: 'tcp' | 'udp'): NetSample[] {
  const lines = text.split('\n')
  const out: NetSample[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line || line.startsWith(' ') || line.startsWith('\t')) continue
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue
    const proc = line.match(/users:\(\("([^"]*)",pid=(\d+)/)
    if (!proc) continue
    const info = lines[i + 1] ?? ''
    const sent = info.match(/bytes_sent:(\d+)/)
    const recv = info.match(/bytes_received:(\d+)/)
    if (!sent || !recv) continue
    const pid = Number(proc[2])
    if (!Number.isInteger(pid)) continue
    out.push({
      proto,
      local: parts[3]!,
      remote: parts[4]!,
      ...(parts[0] ? { state: parts[0] } : {}),
      pid,
      name: proc[1]!,
      rxBytes: Number(recv[1]),
      txBytes: Number(sent[1]),
    })
  }
  return out
}

function key(row: NetSample): string {
  return `${row.proto}\0${row.local}\0${row.remote}\0${row.pid}`
}

/** Bytes/s for connections present in both samples. Idle rows (both rates 0) are dropped. */
export function netRates(prev: NetSample[], next: NetSample[], seconds: number): NetRow[] {
  if (!(seconds > 0)) return []
  const before = new Map(prev.map((row) => [key(row), row]))
  const rows: NetRow[] = []
  for (const row of next) {
    const prior = before.get(key(row))
    if (!prior) continue
    const rx = row.rxBytes - prior.rxBytes
    const tx = row.txBytes - prior.txBytes
    if (rx < 0 || tx < 0) continue
    const rxRate = Math.round(rx / seconds)
    const txRate = Math.round(tx / seconds)
    if (rxRate === 0 && txRate === 0) continue
    rows.push({
      proto: row.proto,
      local: row.local,
      remote: row.remote,
      ...(row.state ? { state: row.state } : {}),
      pid: row.pid,
      name: row.name,
      rx_bytes_per_s: rxRate,
      tx_bytes_per_s: txRate,
    })
  }
  rows.sort(
    (a, b) => b.rx_bytes_per_s + b.tx_bytes_per_s - (a.rx_bytes_per_s + a.tx_bytes_per_s) || a.pid - b.pid,
  )
  return rows
}

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err ? String((err as { stderr?: unknown }).stderr) : ''
    const detail = stderr.trim().split('\n')[0]
    throw new NetError(
      `${cmd} failed${detail ? `: ${detail}` : ''}. sloppytop net does not escalate privileges.`,
    )
  }
}

function collectDarwin(): NetSample[] {
  const tcp = run('/usr/sbin/netstat', ['-anv', '-p', 'tcp'])
  const udp = run('/usr/sbin/netstat', ['-anv', '-p', 'udp'])
  for (const text of [tcp, udp]) {
    if (!darwinNetstatOk(text)) {
      throw new NetError(
        'netstat did not return per-connection byte counters. sloppytop net does not escalate privileges.',
      )
    }
  }
  return [...parseDarwinNetstat(tcp), ...parseDarwinNetstat(udp)]
}

function collectLinux(): NetSample[] {
  const tcp = run('ss', ['-H', '-tinp'])
  const udp = run('ss', ['-H', '-uinp'])
  return [...parseSs(tcp, 'tcp'), ...parseSs(udp, 'udp')]
}

export function collectNetSamples(): NetSample[] {
  switch (platform()) {
    case 'darwin':
      return collectDarwin()
    case 'linux':
      return collectLinux()
    case 'win32':
      throw new NetError(
        'per-connection byte rates need an ETW trace on Windows, which sloppytop net does not start. There is no unprivileged counter.',
      )
    default:
      throw new NetError(`per-connection byte rates are not available on ${platform()}.`)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Two samples `sampleMs` apart. The first sample has no rate, so it is only the baseline. */
export async function sampleNet(sampleMs: number): Promise<NetRow[]> {
  const first = collectNetSamples()
  await sleep(sampleMs)
  const second = collectNetSamples()
  return netRates(first, second, sampleMs / 1000)
}
