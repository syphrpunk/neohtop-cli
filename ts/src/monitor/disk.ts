// Per-device disk counters. Rates are deltas across two refreshes, same as
// network. Latency is the interval's average service time and is omitted
// when the platform has no time counter or the interval had zero operations.
//
// Linux /proc/diskstats "sectors" are 512-byte units regardless of the
// drive's physical sector size. The read/write time columns are milliseconds.
// macOS IOBlockStorageDriver "Total Time" is nanoseconds.

import type { DiskCounters, DiskDevice } from './types.ts'

const LINUX_SECTOR_BYTES = 512n
const NS_PER_MS = 1_000_000n

/** Whole disks and mapper/raid devices. Partitions and ram/loop nodes are not devices. */
export function isWholeDisk(name: string): boolean {
  if (/^(?:loop|ram|zram|fd|sr)\d+$/.test(name)) return false
  return (
    /^(?:sd|hd|vd|xvd)[a-z]+$/.test(name) ||
    /^nvme\d+n\d+$/.test(name) ||
    /^mmcblk\d+$/.test(name) ||
    /^dm-\d+$/.test(name) ||
    /^md\d+$/.test(name) ||
    /^nbd\d+$/.test(name) ||
    /^dasd[a-z]+$/.test(name)
  )
}

/**
 * `/proc/diskstats`. Rows that are not whole devices are dropped.
 * A short or non-numeric row is dropped rather than stored as zero.
 */
export function parseDiskstats(text: string): DiskCounters[] {
  const out: DiskCounters[] = []
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/)
    if (f.length < 11) continue
    const name = f[2]
    if (!name || !isWholeDisk(name)) continue
    const readOps = nat(f[3])
    const readMerges = nat(f[4])
    const readSectors = nat(f[5])
    const readMs = nat(f[6])
    const writeOps = nat(f[7])
    const writeMerges = nat(f[8])
    const writeSectors = nat(f[9])
    const writeMs = nat(f[10])
    if (
      readOps === undefined ||
      readMerges === undefined ||
      readSectors === undefined ||
      readMs === undefined ||
      writeOps === undefined ||
      writeMerges === undefined ||
      writeSectors === undefined ||
      writeMs === undefined
    ) {
      continue
    }
    out.push({
      name,
      readBytes: readSectors * LINUX_SECTOR_BYTES,
      writeBytes: writeSectors * LINUX_SECTOR_BYTES,
      readOps,
      writeOps,
      readTimeNs: readMs * NS_PER_MS,
      writeTimeNs: writeMs * NS_PER_MS,
      readMerges,
      writeMerges,
    })
  }
  return out
}

/**
 * `ioreg -r -c IOBlockStorageDriver -d 2` plus `ioreg -r -c IOMedia -d 0`.
 * The device name is the child media's BSD name (`disk0`). The registry
 * name is the fallback when that id has no BSD name.
 */
export function parseIoregDisks(driverText: string, mediaText: string): DiskCounters[] {
  const bsd = bsdNames(mediaText)
  const out: DiskCounters[] = []
  const seen = new Set<string>()
  for (const block of driverText.split(/(?=^\+-o IOBlockStorageDriver)/m)) {
    if (!block.includes('IOBlockStorageDriver')) continue
    const stats = block.match(/"Statistics" = \{([^}]*)\}/)
    const child = block.match(/\+-o (.+?)  <class IOMedia, id (0x[0-9a-fA-F]+)/)
    if (!stats || !child) continue
    const readBytes = field(stats[1]!, 'Bytes (Read)')
    const writeBytes = field(stats[1]!, 'Bytes (Write)')
    const readOps = field(stats[1]!, 'Operations (Read)')
    const writeOps = field(stats[1]!, 'Operations (Write)')
    if (
      readBytes === undefined ||
      writeBytes === undefined ||
      readOps === undefined ||
      writeOps === undefined
    ) {
      continue
    }
    const id = child[2]!.toLowerCase()
    let name = bsd.get(id) ?? child[1]!.trim()
    if (seen.has(name)) name = `${name} ${id}`
    seen.add(name)
    const row: DiskCounters = { name, readBytes, writeBytes, readOps, writeOps }
    const readTimeNs = field(stats[1]!, 'Total Time (Read)')
    const writeTimeNs = field(stats[1]!, 'Total Time (Write)')
    if (readTimeNs !== undefined) row.readTimeNs = readTimeNs
    if (writeTimeNs !== undefined) row.writeTimeNs = writeTimeNs
    out.push(row)
  }
  return out
}

/**
 * Bytes/s and IOPS between two cumulative samples. A device missing from
 * the previous sample, or any counter that went backwards, is omitted for
 * this interval. `elapsedSec <= 0` (the first refresh) returns nothing.
 */
export function diskRates(
  prev: DiskCounters[] | undefined,
  next: DiskCounters[],
  elapsedSec: number,
): DiskDevice[] {
  if (!prev || elapsedSec <= 0) return []
  const prior = new Map(prev.map((d) => [d.name, d]))
  const out: DiskDevice[] = []
  for (const cur of next) {
    const was = prior.get(cur.name)
    if (!was) continue
    const readBytes = cur.readBytes - was.readBytes
    const writeBytes = cur.writeBytes - was.writeBytes
    const readOps = cur.readOps - was.readOps
    const writeOps = cur.writeOps - was.writeOps
    if (readBytes < 0n || writeBytes < 0n || readOps < 0n || writeOps < 0n) continue
    const readMerges = mergeDelta(was.readMerges, cur.readMerges)
    const writeMerges = mergeDelta(was.writeMerges, cur.writeMerges)
    if (readMerges === null || writeMerges === null) continue
    const device: DiskDevice = {
      name: cur.name,
      read_bytes_per_s: Math.round(Number(readBytes) / elapsedSec),
      write_bytes_per_s: Math.round(Number(writeBytes) / elapsedSec),
      read_iops: round1(Number(readOps) / elapsedSec),
      write_iops: round1(Number(writeOps) / elapsedSec),
    }
    const readLatency = latencyMs(was.readTimeNs, cur.readTimeNs, readOps)
    const writeLatency = latencyMs(was.writeTimeNs, cur.writeTimeNs, writeOps)
    if (readLatency !== undefined) device.read_latency_ms = readLatency
    if (writeLatency !== undefined) device.write_latency_ms = writeLatency
    if (readMerges !== undefined) device.read_merges_per_s = round1(Number(readMerges) / elapsedSec)
    if (writeMerges !== undefined) device.write_merges_per_s = round1(Number(writeMerges) / elapsedSec)
    const readRequest = requestBytes(readBytes, readOps)
    const writeRequest = requestBytes(writeBytes, writeOps)
    if (readRequest !== undefined) device.read_request_bytes = readRequest
    if (writeRequest !== undefined) device.write_request_bytes = writeRequest
    out.push(device)
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out
}

/** Undefined when either sample has no merge counter. Null when the counter went backwards. */
function mergeDelta(prev: bigint | undefined, next: bigint | undefined): bigint | undefined | null {
  if (prev === undefined || next === undefined) return
  if (next < prev) return null
  return next - prev
}

function requestBytes(bytes: bigint, ops: bigint): number | undefined {
  if (ops <= 0n) return
  return Math.round(Number(bytes) / Number(ops))
}

function latencyMs(
  prevNs: bigint | undefined,
  nextNs: bigint | undefined,
  ops: bigint,
): number | undefined {
  if (ops <= 0n || prevNs === undefined || nextNs === undefined) return
  const delta = nextNs - prevNs
  if (delta < 0n) return
  return round3(Number(delta) / 1e6 / Number(ops))
}

function bsdNames(mediaText: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const block of mediaText.split(/\n(?=[ |]*\+-o )/)) {
    const id = block.match(/<class IOMedia, id (0x[0-9a-fA-F]+)/)
    const name = block.match(/"BSD Name" = "([^"]+)"/)
    if (id && name) map.set(id[1]!.toLowerCase(), name[1]!)
  }
  return map
}

function field(body: string, label: string): bigint | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // ioreg prints `"Bytes (Read)"=123` — the closing quote sits before `=`.
  const m = body.match(new RegExp(`${escaped}"?=(\\d+)`))
  return m ? BigInt(m[1]!) : undefined
}

function nat(value: string | undefined): bigint | undefined {
  if (!value || !/^\d+$/.test(value)) return
  return BigInt(value)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
