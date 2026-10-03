import { describe, expect, test } from 'bun:test'
import { diskRates, isWholeDisk, parseDiskstats, parseIoregDisks } from './disk.ts'
import type { DiskCounters } from './types.ts'

const DISKSTATS = `
   7       0 loop0 5 0 10 1 0 0 0 0 0 0 0 0
   8       0 sda 100 0 200 50 40 0 80 20 0 70 70
   8       1 sda1 100 0 200 50 40 0 80 20 0 70 70
 259       0 nvme0n1 10 0 20 5 0 0 0 0 0 5 5
 253       0 dm-0 3 0 8 4 1 0 2 2 0 6 6
   1       0 ram0 9 0 9 1 0 0 0 0 0 1 1
`

const IOREG_DRIVERS = `
+-o IOBlockStorageDriver  <class IOBlockStorageDriver, id 0x100000944, registered, matched, active, busy 0 (560 ms), retain 9>
  | {
  |   "Statistics" = {"Operations (Write)"=40,"Latency Time (Write)"=0,"Bytes (Read)"=2000,"Errors (Write)"=0,"Total Time (Read)"=5000000,"Latency Time (Read)"=0,"Retries (Read)"=0,"Errors (Read)"=0,"Total Time (Write)"=8000000,"Bytes (Write)"=4000,"Operations (Read)"=10,"Retries (Write)"=0}
  | }
  | 
  +-o APPLE SSD AP0512Z Media  <class IOMedia, id 0x100000945, registered, matched, active, busy 0 (563 ms), retain 12>

+-o IOBlockStorageDriver  <class IOBlockStorageDriver, id 0x100051f87, registered, matched, active, busy 0 (19 ms), retain 8>
  | {
  |   "Statistics" = {"Operations (Write)"=0,"Bytes (Read)"=100,"Total Time (Read)"=0,"Total Time (Write)"=0,"Bytes (Write)"=0,"Operations (Read)"=1}
  | }
  | 
  +-o Apple Disk Image Media  <class IOMedia, id 0x100051f88, registered, matched, active, busy 0 (19 ms), retain 10>
`

const IOREG_MEDIA = `
+-o APPLE SSD AP0512Z Media  <class IOMedia, id 0x100000945, registered, matched, active, busy 0 (563 ms), retain 12>
  | {
  |   "Whole" = Yes
  |   "BSD Name" = "disk0"
  | }
+-o Apple Disk Image Media  <class IOMedia, id 0x100051f88, registered, matched, active, busy 0 (19 ms), retain 10>
  | {
  |   "Whole" = Yes
  |   "BSD Name" = "disk4"
  | }
`

describe('disk devices', () => {
  test('whole-disk names keep the device and drop partitions and loop nodes', () => {
    expect(isWholeDisk('sda')).toBe(true)
    expect(isWholeDisk('nvme0n1')).toBe(true)
    expect(isWholeDisk('dm-0')).toBe(true)
    expect(isWholeDisk('sda1')).toBe(false)
    expect(isWholeDisk('nvme0n1p1')).toBe(false)
    expect(isWholeDisk('loop0')).toBe(false)
    expect(isWholeDisk('ram0')).toBe(false)
  })

  test('diskstats sectors are 512 bytes and time is milliseconds', () => {
    const rows = parseDiskstats(DISKSTATS)
    expect(rows.map((r) => r.name)).toEqual(['sda', 'nvme0n1', 'dm-0'])
    const sda = rows[0]!
    expect(sda.readBytes).toBe(200n * 512n)
    expect(sda.writeBytes).toBe(80n * 512n)
    expect(sda.readOps).toBe(100n)
    expect(sda.writeOps).toBe(40n)
    expect(sda.readTimeNs).toBe(50n * 1_000_000n)
    expect(sda.writeTimeNs).toBe(20n * 1_000_000n)
  })

  test('ioreg names the device by BSD name and keeps total time in nanoseconds', () => {
    const rows = parseIoregDisks(IOREG_DRIVERS, IOREG_MEDIA)
    expect(rows.map((r) => r.name)).toEqual(['disk0', 'disk4'])
    expect(rows[0]).toMatchObject({
      readBytes: 2000n,
      writeBytes: 4000n,
      readOps: 10n,
      writeOps: 40n,
      readTimeNs: 5_000_000n,
      writeTimeNs: 8_000_000n,
    })
  })

  test('rates are deltas, idle ops omit latency, and a reset drops the device', () => {
    const base = (over: Partial<DiskCounters>): DiskCounters => ({
      name: 'sda',
      readBytes: 0n,
      writeBytes: 0n,
      readOps: 0n,
      writeOps: 0n,
      readTimeNs: 0n,
      writeTimeNs: 0n,
      ...over,
    })
    const next = parseDiskstats(DISKSTATS).filter((r) => r.name === 'sda')
    expect(diskRates(undefined, next, 2)).toEqual([])
    const rates = diskRates([base({})], next, 2)
    expect(rates).toEqual([
      {
        name: 'sda',
        read_bytes_per_s: (200 * 512) / 2,
        write_bytes_per_s: (80 * 512) / 2,
        read_iops: 50,
        write_iops: 20,
        read_latency_ms: 0.5,
        write_latency_ms: 0.5,
      },
    ])
    const idle = diskRates(
      [base({ name: 'nvme0n1', readOps: 10n, readTimeNs: 5n * 1_000_000n })],
      [base({ name: 'nvme0n1', readOps: 10n, readTimeNs: 5n * 1_000_000n })],
      1,
    )
    expect(idle[0]).toMatchObject({ read_iops: 0, read_bytes_per_s: 0 })
    expect(idle[0]).not.toHaveProperty('read_latency_ms')

    const reset = diskRates([base({ readBytes: 999n })], [base({ readBytes: 1n })], 1)
    expect(reset).toEqual([])
  })
})
