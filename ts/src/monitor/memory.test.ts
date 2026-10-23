import { describe, expect, test } from 'bun:test'
import { memoryFromMeminfo, memoryFromVmStat, pageRates, pagingFromVmstat } from './memory.ts'

const VM_STAT = `
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                5.
Pages active:                              10.
Pages inactive:                            4.
Pages wired down:                          3.
Pages occupied by compressor:              0.
File-backed pages:                         7.
Compressions:                              20.
Decompressions:                            6.
Pageins:                                   100.
Pageouts:                                  2.
`

describe('memory composition', () => {
  test('vm_stat keeps the used total and a measured compressor of 0', () => {
    const mem = memoryFromVmStat(VM_STAT, 16384, 1_000_000)
    expect(mem.used).toBe((10 + 3 + 0) * 16384)
    expect(mem.free).toBe(1_000_000 - mem.used)
    expect(mem.app).toBe(10 * 16384)
    expect(mem.wired).toBe(3 * 16384)
    expect(mem.compressed).toBe(0)
    expect(mem.cached).toBe(7 * 16384)
    expect(mem.pages).toEqual({ pageins: 100, pageouts: 2, compressions: 20, decompressions: 6 })
  })

  test('a missing vm_stat key is omitted and does not become zero', () => {
    const mem = memoryFromVmStat('Pages active: 1.\n', 4096, 100)
    expect(mem.app).toBe(4096)
    expect(mem).not.toHaveProperty('wired')
    expect(mem).not.toHaveProperty('compressed')
    expect(mem.pages).toEqual({})
    expect(mem.used).toBe(4096)
  })

  test('meminfo app is AnonPages and cached is Buffers plus Cached', () => {
    const text = `
MemTotal:       1000 kB
MemFree:         100 kB
MemAvailable:    400 kB
Buffers:          10 kB
Cached:           30 kB
AnonPages:        50 kB
`
    const mem = memoryFromMeminfo(text)
    expect(mem.total).toBe(1000 * 1024)
    expect(mem.used).toBe(600 * 1024)
    expect(mem.free).toBe(100 * 1024)
    expect(mem.app).toBe(50 * 1024)
    expect(mem.cached).toBe(40 * 1024)
    expect(mem).not.toHaveProperty('compressed')
  })

  test('vmstat pgpgin is kilobytes and a missing zswap key is omitted', () => {
    const pages = pagingFromVmstat('pgpgin 4096\npgpgout 0\n', 4096)
    expect(pages.pageins).toBe(1024)
    expect(pages.pageouts).toBe(0)
    expect(pages).not.toHaveProperty('compressions')
  })

  test('page rates keep a zero delta and omit a backwards counter', () => {
    const prev = { pageins: 10, pageouts: 4, compressions: 8 }
    const next = { pageins: 10, pageouts: 3, compressions: 9 }
    expect(pageRates(prev, next, 2)).toEqual({ pageins_per_s: 0, compressions_per_s: 0.5 })
    expect(pageRates(undefined, next, 2)).toEqual({})
  })
})
