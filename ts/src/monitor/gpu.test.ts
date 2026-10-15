import { describe, expect, test } from 'bun:test'
import { gpuTimeDeltas, parseAgxGpuTime, parseAgxPerformance } from './gpu.ts'
import { optionalSystemStats } from './index.ts'
import type { PlatformSample } from './types.ts'

const IOREG = `
+-o AGXDeviceUserClient  <class AGXDeviceUserClient, id 0x1, !registered, !matched, active, busy 0, retain 5>
    {
      "AppUsage" = ({"API"="Metal","lastSubmittedTime"=10,"accumulatedGPUTime"=1000000},{"API"="Metal","lastSubmittedTime"=11,"accumulatedGPUTime"=500000})
      "IOUserClientCreator" = "pid 697, WindowServer"
    }

+-o AGXDeviceUserClient  <class AGXDeviceUserClient, id 0x2, !registered, !matched, active, busy 0, retain 5>
    {
      "AppUsage" = ({"API"="Metal","lastSubmittedTime"=12,"accumulatedGPUTime"=250000})
      "IOUserClientCreator" = "pid 697, WindowServer"
    }

+-o AGXDeviceUserClient  <class AGXDeviceUserClient, id 0x3, !registered, !matched, active, busy 0, retain 5>
    {
      "AppUsage" = ()
      "IOUserClientCreator" = "pid 42, idle"
    }
`

describe('per-process GPU time', () => {
  test('sums every client and every API row for a pid', () => {
    const times = parseAgxGpuTime(IOREG)
    expect(times.get(697)).toBe(1_750_000n)
    expect(times.get(42)).toBe(0n)
    expect(times.size).toBe(2)
  })

  test('delta is milliseconds accrued, idle stays 0, a reset is omitted', () => {
    const prev = new Map<number, bigint>([
      [697, 1_000_000n],
      [42, 0n],
      [7, 50n],
    ])
    const next = new Map<number, bigint>([
      [697, 3_500_000n],
      [42, 0n],
      [7, 10n],
      [9, 1_000_000n],
    ])
    expect(gpuTimeDeltas(undefined, next, 0.5).size).toBe(0)
    const delta = gpuTimeDeltas(prev, next, 0.5)
    expect(delta.get(697)).toBe(2.5)
    expect(delta.get(42)).toBe(0)
    expect(delta.has(7)).toBe(false)
    expect(delta.has(9)).toBe(false)
  })
})

const PERFORMANCE = `
+-o AGXAccelerator  <class AGXAccelerator, id 0x1>
  | {
  |   "PerformanceStatistics" = {"Device Utilization %"=0,"Renderer Utilization %"=19,"Tiler Utilization %"=20,"Alloc system memory"=111,"In use system memory (driver)"=7,"In use system memory"=565608448}
  |   "IOReportLegend" = ({"Device Utilization %"=99})
  | }
`

describe('AGX performance statistics', () => {
  test('reads utilization and in-use memory, and ignores the driver counter', () => {
    expect(parseAgxPerformance(PERFORMANCE)).toEqual({
      devicePercent: 0,
      rendererPercent: 19,
      tilerPercent: 20,
      memoryBytes: 565608448,
    })
  })

  test('a missing dictionary is omitted, and an empty one is omitted', () => {
    expect(parseAgxPerformance('"IOReportLegend" = ({"Device Utilization %"=99})')).toBeUndefined()
    expect(parseAgxPerformance('"PerformanceStatistics" = {}')).toBeUndefined()
  })

  test('a measured zero is copied and a missing key stays absent', () => {
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
    expect(
      optionalSystemStats({
        ...base,
        gpuActivity: { devicePercent: 0, memoryBytes: 565608448 },
      }),
    ).toEqual({
      gpu_utilization_percent: 0,
      gpu_memory_bytes: 565608448,
    })
  })
})
