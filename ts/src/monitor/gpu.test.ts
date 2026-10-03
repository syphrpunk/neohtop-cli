import { describe, expect, test } from 'bun:test'
import { gpuTimeDeltas, parseAgxGpuTime } from './gpu.ts'

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
