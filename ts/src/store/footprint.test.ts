import { describe, expect, test } from 'bun:test'
import { detectLeak, LEAK_DEFAULTS, linearFit, scoreGroup, type SeriesPoint } from './footprint.ts'

const hour = 60 * 60 * 1000

describe('linearFit', () => {
  test('fits a line', () => {
    const fit = linearFit([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
    ])
    expect(fit?.slope).toBeCloseTo(2)
    expect(fit?.rSquared).toBeCloseTo(1)
  })
})

describe('detectLeak', () => {
  const climb = (n: number, bytesPerHour: number): SeriesPoint[] =>
    Array.from({ length: n }, (_, i) => ({
      at: i * hour,
      bytes: 100 * 1024 * 1024 + i * bytesPerHour,
    }))

  test('flags a steady RSS climb and rejects a short one', () => {
    const found = detectLeak(climb(12, LEAK_DEFAULTS.minimumSlope * 3600))
    expect(found).not.toBeNull()
    expect(found!.slopeBytesPerSecond).toBeCloseTo(LEAK_DEFAULTS.minimumSlope, 0)
    expect(detectLeak(climb(12, LEAK_DEFAULTS.minimumSlope * 3600).slice(0, 4))).toBeNull()
  })

  test('a jump that then sits still is not a leak', () => {
    const points = climb(12, 0).map((p, i) => ({ ...p, bytes: i === 0 ? 1000 : 200 * 1024 * 1024 }))
    expect(detectLeak(points)).toBeNull()
  })

  test('a hole longer than two hours breaks the series', () => {
    const points = climb(12, LEAK_DEFAULTS.minimumSlope * 3600).map((point, i) =>
      i >= 6 ? { ...point, at: point.at + 2 * hour } : point,
    )
    expect(detectLeak(points)).toBeNull()
  })
})

describe('scoreGroup', () => {
  test('splits CPU share of the machine and memory share of RAM evenly', () => {
    const group = scoreGroup([{ name: 'chrome', cpuPercent: 100, memoryBytes: 500 }], {
      cores: 1,
      totalBytes: 1000,
    })
    // cpu share 1, memory share 0.5 → 0.5 * 1 + 0.5 * 0.5 = 0.75 → 75
    expect(group.score).toBeCloseTo(75)
    expect(group.members[0]!.share).toBeCloseTo(1)
  })

  test('member shares sum to 1', () => {
    const group = scoreGroup(
      [
        { name: 'a', cpuPercent: 100, memoryBytes: 100 },
        { name: 'b', cpuPercent: 0, memoryBytes: 300 },
      ],
      { cores: 2, totalBytes: 1000 },
    )
    const shares = group.members.reduce((sum, member) => sum + member.share, 0)
    expect(shares).toBeCloseTo(1)
    expect(group.members[0]!.name).toBe('a')
  })
})
