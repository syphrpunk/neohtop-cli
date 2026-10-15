import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { logEvent } from './log.ts'

describe('logEvent', () => {
  test('appends one line and folds newlines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'neohtop-log-'))
    const file = join(dir, 'nested', 'neohtop.log')
    logEvent('warn', 'proc', 'open files\nunavailable', file)
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z warn proc open files unavailable$/)
  })

  test('the first call writes the info line to the same file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'neohtop-log-'))
    const file = join(dir, 'neohtop.log')
    logEvent('error', 'kill', 'failed to signal pid 1', file)
    logEvent('info', 'record', 'sample 4 stored 3', file)
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('error kill failed to signal pid 1')
    expect(lines[1]).toContain('info record sample 4 stored 3')
  })
})
