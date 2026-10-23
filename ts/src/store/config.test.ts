import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { goTuiConfigPath, normalizeConfig, resolveConfigDir, resolveNamedFile, resolveTui } from './config.ts'

describe('normalizeConfig', () => {
  test('older files without pins stay empty', () => {
    expect(normalizeConfig({ record: { processLimit: 5 } }).pins).toEqual([])
    expect(normalizeConfig({ record: { processLimit: 5 } }).record.processLimit).toBe(5)
    expect(normalizeConfig({ record: { processLimit: 5 } }).record.retentionDays).toBe(30)
  })

  test('keeps string pins and drops blanks', () => {
    expect(normalizeConfig({ pins: [' postgres ', '', 3, 'node'] }).pins).toEqual(['postgres', 'node'])
  })

  test('missing probe and metrics keys stay at the defaults', () => {
    const config = normalizeConfig({ record: { processLimit: 5 } })
    expect(config.probes.cpu).toBe(true)
    expect(config.probes.sensors).toBe(true)
    expect(config.metrics).toEqual({ enabled: false, host: '127.0.0.1', port: 9464 })
  })

  test('an explicit probe false is kept and a bad metrics port is ignored', () => {
    const config = normalizeConfig({
      probes: { sensors: false, nope: true },
      metrics: { enabled: true, host: 'bad host', port: 0 },
    })
    expect(config.probes.sensors).toBe(false)
    expect(config.probes.cpu).toBe(true)
    expect(config.metrics).toEqual({ enabled: true, host: '127.0.0.1', port: 9464 })
  })

  test('missing screen keys stay at the Go defaults', () => {
    const config = normalizeConfig({})
    expect(config.tui.theme).toBe('charm')
    expect(config.tui.refreshMs).toBe(1000)
    expect(config.tui.columns).toEqual(['pid', 'name', 'command', 'threads', 'user', 'memory', 'cpu'])
  })

  test('an unknown theme and a too-fast refresh fall back, and known columns stay', () => {
    const config = normalizeConfig({
      tui: { theme: 'nope', refreshMs: 50, columns: ['cpu', 'nope', 'cpu', 'owning_app'] },
    })
    expect(config.tui.theme).toBe('charm')
    expect(config.tui.refreshMs).toBe(1000)
    expect(config.tui.columns).toEqual(['cpu', 'owning_app'])
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

  test('the Go screen file prefers sloppytop-cli and keeps neohtop-cli otherwise', () => {
    const home = mkdtempSync(join(tmpdir(), 'sloppytop-go-'))
    expect(goTuiConfigPath(home)).toBe(join(home, '.config', 'sloppytop-cli', 'config.json'))
    mkdirSync(join(home, '.config', 'neohtop-cli'), { recursive: true })
    writeFileSync(join(home, '.config', 'neohtop-cli', 'config.json'), '{}')
    expect(goTuiConfigPath(home)).toBe(join(home, '.config', 'neohtop-cli', 'config.json'))
    mkdirSync(join(home, '.config', 'sloppytop-cli'), { recursive: true })
    writeFileSync(join(home, '.config', 'sloppytop-cli', 'config.json'), '{}')
    expect(goTuiConfigPath(home)).toBe(join(home, '.config', 'sloppytop-cli', 'config.json'))
  })

  test('a missing screen block copies the Go file once, and an existing block wins', () => {
    const go = { columns: ['pid', 'cpu'], refresh_rate_ms: 2000, theme: 'nord' }
    const imported = resolveTui({ record: { processLimit: 5 } }, go)
    expect(imported.imported).toBe(true)
    expect(imported.tui).toEqual({ columns: ['pid', 'cpu'], refreshMs: 2000, theme: 'nord' })
    const kept = resolveTui({ tui: { theme: 'mocha', refreshMs: 800, columns: ['memory'] } }, go)
    expect(kept.imported).toBe(false)
    expect(kept.tui.theme).toBe('mocha')
    expect(kept.tui.refreshMs).toBe(800)
    expect(resolveTui({}, { pins: ['node'] }).imported).toBe(false)
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
