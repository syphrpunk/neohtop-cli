import { describe, expect, test } from 'bun:test'
import { readPhysFootprint } from './darwin_ffi.ts'

describe('readPhysFootprint', () => {
  test('reads the uint64 at offset 72, including a measured zero', () => {
    const buf = new ArrayBuffer(160)
    const view = new DataView(buf)
    view.setBigUint64(72, 4096n, true)
    view.setBigUint64(144, 99n, true)
    expect(readPhysFootprint(view)).toBe(4096)
    view.setBigUint64(72, 0n, true)
    expect(readPhysFootprint(view)).toBe(0)
  })

  test('a short buffer or an unsafe integer is omitted', () => {
    expect(readPhysFootprint(new DataView(new ArrayBuffer(72)))).toBeUndefined()
    const buf = new ArrayBuffer(160)
    const view = new DataView(buf)
    view.setBigUint64(72, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)
    expect(readPhysFootprint(view)).toBeUndefined()
  })
})
