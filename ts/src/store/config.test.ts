import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { normalizeConfig, resolveConfigDir, resolveNamedFile } from './config.ts'

describe('normalizeConfig', () => {
  test('older files without pins stay empty', () => {
    expect(normalizeConfig({ record: { processLimit: 5 } }).pins).toEqual([])
    expect(normalizeConfig({ record: { processLimit: 5 } }).record.processLimit).toBe(5)
    expect(normalizeConfig({ record: { processLimit: 5 } }).record.retentionDays).toBe(30)
  })

  test('keeps string pins and drops blanks', () => {
    expect(normalizeConfig({ pins: [' postgres ', '', 3, 'node'] }).pins).toEqual(['postgres', 'node'])
  })

  test('keeps named groups and drops empty ones', () => {
    expect(normalizeConfig({}).groups).toEqual([])
    expect(
      normalizeConfig({
        groups: [
          { name: ' browsers ', patterns: [' chrome ', ''] },
          { name: '', patterns: ['x'] },
          { name: 'empty', patterns: [] },
        ],
      }).groups,
    ).toEqual([{ name: 'browsers', patterns: ['chrome'] }])
  })
})

describe('config path fallback', () => {
  test('uses sloppytop when neither directory exists', () => {
    const base = mkdtempSync(join(tmpdir(), 'sloppytop-cfg-'))
    expect(resolveConfigDir(base)).toBe(join(base, 'sloppytop'))
  })

  test('keeps neohtop when that is the only directory', () => {
    const base = mkdtempSync(join(tmpdir(), 'sloppytop-cfg-'))
    mkdirSync(join(base, 'neohtop'))
    expect(resolveConfigDir(base)).toBe(join(base, 'neohtop'))
  })

  test('prefers sloppytop when both directories exist', () => {
    const base = mkdtempSync(join(tmpdir(), 'sloppytop-cfg-'))
    mkdirSync(join(base, 'neohtop'))
    mkdirSync(join(base, 'sloppytop'))
    expect(resolveConfigDir(base)).toBe(join(base, 'sloppytop'))
  })

  test('keeps neohtop.db until sloppytop.db exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sloppytop-cfg-'))
    expect(resolveNamedFile(dir, 'sloppytop.db', 'neohtop.db')).toBe(join(dir, 'sloppytop.db'))
    writeFileSync(join(dir, 'neohtop.db'), '')
    expect(resolveNamedFile(dir, 'sloppytop.db', 'neohtop.db')).toBe(join(dir, 'neohtop.db'))
    writeFileSync(join(dir, 'sloppytop.db'), '')
    expect(resolveNamedFile(dir, 'sloppytop.db', 'neohtop.db')).toBe(join(dir, 'sloppytop.db'))
  })
})
