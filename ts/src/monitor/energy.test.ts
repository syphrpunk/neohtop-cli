import { describe, expect, test } from 'bun:test'
import { powerWatts, toNanojoules, wattsFromDelta } from './energy.ts'

describe('toNanojoules', () => {
  test('mJ and nJ', () => {
    expect(toNanojoules(1, 'mJ')).toBe(1_000_000n)
    expect(toNanojoules(2_000_000_000n, 'nJ')).toBe(2_000_000_000n)
  })

  test('unknown unit and a negative counter are skipped', () => {
    expect(toNanojoules(1, 'events')).toBeNull()
    expect(toNanojoules(-1, 'mJ')).toBeNull()
  })
})

describe('wattsFromDelta', () => {
  test('1 joule in one second is 1 watt', () => {
    expect(wattsFromDelta(0n, 1_000_000_000n, 1)).toBe(1)
  })

  test('a zero delta is idle, a backwards counter is a reset', () => {
    expect(wattsFromDelta(5n, 5n, 1)).toBe(0)
    expect(wattsFromDelta(10n, 9n, 1)).toBeNull()
    expect(wattsFromDelta(0n, 1n, 0)).toBeNull()
  })
})

describe('powerWatts', () => {
  test('converts only the rails present on both samples', () => {
    const prev = { cpu: 0n, gpu: 1_000_000_000n }
    const next = { cpu: 2_000_000_000n, ane: 0n }
    expect(powerWatts(prev, next, 1)).toEqual({ cpu: 2 })
  })
})
