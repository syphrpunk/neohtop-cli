import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import type { ProbeLogEntry } from '../monitor/probes.ts'
import { appendProbeLog, readProbeLog } from './probe-log.ts'

function entry(probe: ProbeLogEntry['probe'], n: number): ProbeLogEntry {
  return { at: '2026-10-23T00:00:00.000Z', probe, n }
}

describe('probe log', () => {
  test('appends JSON lines and reads the newest matching probe', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sloppytop-probes-')), 'probes.jsonl')
    appendProbeLog([entry('cpu', 1), entry('memory', 2)], file)
    appendProbeLog([entry('cpu', 3)], file)
    expect(readProbeLog({ file, probe: 'cpu', limit: 1 })).toEqual([entry('cpu', 3)])
    expect(readProbeLog({ file, limit: 10 })).toHaveLength(3)
  })

  test('rotation keeps a valid trailing line', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sloppytop-probes-')), 'probes.jsonl')
    const fat = { at: '2026-10-23T00:00:00.000Z', probe: 'cpu' as const, pad: 'x'.repeat(80) }
    const limits = { max: 200, keep: 100 }
    appendProbeLog([fat], file, limits)
    appendProbeLog([fat], file, limits)
    const grown = statSync(file).size
    appendProbeLog([fat], file, limits)
    expect(statSync(file).size).toBeLessThan(grown)
    const rows = readProbeLog({ file, limit: 10 })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.probe === 'cpu')).toBe(true)
  })
})
