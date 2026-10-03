import { describe, expect, test } from 'bun:test'
import { normalizeConfig } from './config.ts'

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
