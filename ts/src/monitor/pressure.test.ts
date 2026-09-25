import { describe, expect, test } from 'bun:test'
import { parseMemoryPressureLevel } from './darwin.ts'
import { optionalSystemStats } from './index.ts'
import { parsePsiSomeAvg10 } from './linux.ts'
import type { PlatformSample } from './types.ts'

describe('parsePsiSomeAvg10', () => {
  test('reads some avg10 and ignores the full line', () => {
    const text = `some avg10=12.50 avg60=3.00 avg300=1.00 total=9
full avg10=99.00 avg60=1.00 avg300=0.00 total=1
`
    expect(parsePsiSomeAvg10(text)).toBe(12.5)
  })

  test('a measured zero is zero, not absent', () => {
    expect(parsePsiSomeAvg10('some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n')).toBe(0)
  })

  test('cpu file with only some, and garbage', () => {
    expect(parsePsiSomeAvg10('some avg10=1.25 avg60=0.00 avg300=0.00 total=4\n')).toBe(1.25)
    expect(parsePsiSomeAvg10('')).toBeNull()
    expect(parsePsiSomeAvg10('full avg10=4.00 avg60=0.00 avg300=0.00 total=1\n')).toBeNull()
  })
})

describe('parseMemoryPressureLevel', () => {
  test('userspace notes, not the internal 0-4 enum', () => {
    expect(parseMemoryPressureLevel('1\n')).toBe('normal')
    expect(parseMemoryPressureLevel('2')).toBe('warning')
    expect(parseMemoryPressureLevel('4')).toBe('critical')
  })

  test('internal enum values and junk are omitted', () => {
    expect(parseMemoryPressureLevel('0')).toBeNull()
    expect(parseMemoryPressureLevel('3')).toBeNull()
    expect(parseMemoryPressureLevel('nope')).toBeNull()
  })
})

describe('optionalSystemStats pressure', () => {
  const base: PlatformSample = {
    cpuBrand: 'c',
    coreCount: 1,
    memoryTotal: 1,
    memoryUsed: 1,
    memoryFree: 0,
    netRxTotal: 0,
    netTxTotal: 0,
    diskTotal: 1,
    diskUsed: 0,
    diskFree: 1,
    uptimeSecs: 1,
    loadAvg: [0, 0, 0],
    hostname: 'h',
    osVersion: 'o',
    kernelVersion: 'k',
    procs: [],
  }

  test('keeps a zero PSI reading and rounds to two decimals', () => {
    expect(
      optionalSystemStats({
        ...base,
        psiCpuSomeAvg10: 0,
        psiIoSomeAvg10: 1.256,
        memoryPressureLevel: 'normal',
      }),
    ).toEqual({
      psi_cpu_some_avg10: 0,
      psi_io_some_avg10: 1.26,
      memory_pressure_level: 'normal',
    })
  })
})
