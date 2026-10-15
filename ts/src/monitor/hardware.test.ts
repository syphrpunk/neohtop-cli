import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  cleanCpuFeatures,
  hardwareInventory,
  normalizeHardware,
  parseCpuinfoFlags,
  parseDarwinHardware,
  parseHwOptional,
  parseLinuxHardware,
  parseWindowsHardware,
  readHardwareCache,
  writeHardwareCache,
} from './hardware.ts'

const PROFILER = {
  SPHardwareDataType: [
    {
      chip_type: 'Apple M3',
      machine_name: 'MacBook Air',
      machine_model: 'Mac15,13',
      number_processors: 'proc 8:4:4:0',
      physical_memory: '16 GB',
      serial_number: 'SECRET',
      platform_UUID: 'SECRET-UUID',
    },
  ],
  SPDisplaysDataType: [
    {
      sppci_model: 'Apple M3',
      sppci_cores: '10',
      spdisplays_ndrvs: [
        {
          _name: 'Color LCD',
          _spdisplays_resolution: '2048 x 1326 @ 60.00Hz',
          spdisplays_main: 'spdisplays_yes',
          '_spdisplays_display-serial-number': 'SECRET',
        },
      ],
    },
  ],
  SPPowerDataType: [
    {
      _name: 'spbattery_information',
      sppower_battery_health_info: {
        sppower_battery_health: 'Good',
        sppower_battery_health_maximum_capacity: '81%',
        sppower_battery_cycle_count: 482,
      },
      sppower_battery_model_info: { sppower_battery_serial_number: 'SECRET' },
    },
  ],
}

describe('hardware inventory', () => {
  test('darwin keeps chip, cores, display, and battery health, and drops serials', () => {
    const report = parseDarwinHardware(PROFILER, { memoryBytes: 17_179_869_184, collectedAt: '2026-10-03T00:00:00.000Z' })
    expect(report).toEqual({
      collected_at: '2026-10-03T00:00:00.000Z',
      chip: 'Apple M3',
      model: 'MacBook Air',
      model_id: 'Mac15,13',
      logical_cores: 8,
      performance_cores: 4,
      efficiency_cores: 4,
      gpu_cores: 10,
      memory_bytes: 17_179_869_184,
      displays: [{ name: 'Color LCD', resolution: '2048 x 1326 @ 60.00Hz', main: true }],
      battery: { health: 'Good', maximum_capacity_percent: 81, cycle_count: 482 },
    })
    expect(JSON.stringify(report)).not.toContain('SECRET')
  })

  test('a memory label is the fallback when hw.memsize is absent', () => {
    const report = parseDarwinHardware(
      { SPHardwareDataType: [{ physical_memory: '16 GB' }] },
      { collectedAt: '2026-10-03T00:00:00.000Z' },
    )
    expect(report.memory_bytes).toBe(16_000_000_000)
  })

  test('linux counts processors and battery health from energy_full', () => {
    const report = parseLinuxHardware({
      cpuinfo: 'processor\t: 0\nmodel name\t: Test CPU\nprocessor\t: 1\nmodel name\t: Test CPU\n',
      meminfo: 'MemTotal:       1024 kB\n',
      displays: [
        { name: 'card0-eDP-1', resolution: '1920x1080', connected: true },
        { name: 'card0-DP-1', resolution: '800x600', connected: false },
      ],
      battery: { cycleCount: '12\n', energyFull: '800\n', energyFullDesign: '1000\n' },
      collectedAt: '2026-10-03T00:00:00.000Z',
    })
    expect(report.chip).toBe('Test CPU')
    expect(report.logical_cores).toBe(2)
    expect(report.memory_bytes).toBe(1024 * 1024)
    expect(report.displays).toEqual([{ name: 'card0-eDP-1', resolution: '1920x1080' }])
    expect(report.battery).toEqual({ cycle_count: 12, maximum_capacity_percent: 80 })
    expect(report.cpu_features).toBeUndefined()
  })

  test('linux keeps the first flags line and drops a later Features line', () => {
    const report = parseLinuxHardware({
      cpuinfo: 'processor\t: 0\nflags\t: sse sse2 avx sse\nFeatures\t: fp asimd\n',
      meminfo: 'MemTotal:       1024 kB\n',
      collectedAt: '2026-10-03T00:00:00.000Z',
    })
    expect(report.cpu_features).toEqual(['sse', 'sse2', 'avx'])
    expect(parseCpuinfoFlags('processor : 0\nFeatures : fp asimd fp\n')).toEqual(['fp', 'asimd'])
    expect(parseCpuinfoFlags('processor : 0\n')).toBeUndefined()
  })

  test('windows health is full charge over design capacity', () => {
    const report = parseWindowsHardware(
      {
        model: 'TestBook',
        cpu: 'Test CPU',
        logicalCores: 4,
        memoryBytes: 1000,
        displays: [{ name: 'Generic PnP' }],
        battery: { fullCharge: 4100, designCapacity: 5000 },
      },
      '2026-10-03T00:00:00.000Z',
    )
    expect(report.model).toBe('TestBook')
    expect(report.chip).toBe('Test CPU')
    expect(report.battery?.maximum_capacity_percent).toBe(82)
    expect(report.displays).toEqual([{ name: 'Generic PnP' }])
    expect(report.cpu_features).toBeUndefined()
  })

  test('hw.optional keeps only values that are exactly 1', () => {
    const text = `hw.optional.arm.FEAT_AES: 1
hw.optional.arm.FEAT_PMULL: 0
hw.optional.breakpoint: 6
hw.optional.neon: 1
hw.optional.arm.FEAT_AES: 1
not a flag
`
    expect(parseHwOptional(text)).toEqual(['arm.FEAT_AES', 'neon'])
    expect(parseHwOptional('hw.optional.neon: 0\n')).toBeUndefined()
    expect(cleanCpuFeatures(['arm.FEAT_AES', 'arm.FEAT_AES', 'has space', '', 'neon'])).toEqual([
      'arm.FEAT_AES',
      'neon',
    ])
  })

  test('the cache round-trips the allowlist and marks from_cache', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sloppytop-hw-'))
    const path = join(dir, 'hardware.json')
    const report = parseDarwinHardware(PROFILER, { memoryBytes: 100, collectedAt: '2026-10-03T00:00:00.000Z' })
    writeHardwareCache(path, { ...report, from_cache: true })
    const text = readFileSync(path, 'utf8')
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('from_cache')
    const loaded = readHardwareCache(path)
    expect(loaded?.from_cache).toBe(true)
    expect(loaded?.chip).toBe('Apple M3')
    expect(normalizeHardware({ serial_number: 'SECRET' })).toBeNull()
    expect(
      normalizeHardware({
        collected_at: '2026-10-03T00:00:00.000Z',
        cpu_features: ['ok', 'nope nope'],
        serial_number: 'SECRET',
      })?.cpu_features,
    ).toEqual(['ok'])
    rmSync(dir, { recursive: true, force: true })
  })

  test('a cache that already lists cpu_features is not rewritten from the live machine', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sloppytop-hw-'))
    const path = join(dir, 'hardware.json')
    const report = parseDarwinHardware(PROFILER, {
      memoryBytes: 100,
      collectedAt: '2026-10-03T00:00:00.000Z',
      cpuFeatures: ['kept'],
    })
    writeHardwareCache(path, report)
    const loaded = hardwareInventory({ cachePath: path })
    expect(loaded.cpu_features).toEqual(['kept'])
    expect(loaded.collected_at).toBe('2026-10-03T00:00:00.000Z')
    expect(loaded.from_cache).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('a cache missing cpu_features is filled without moving collected_at', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sloppytop-hw-'))
    const path = join(dir, 'hardware.json')
    const report = parseDarwinHardware(PROFILER, { memoryBytes: 100, collectedAt: '2026-10-03T00:00:00.000Z' })
    expect(report.cpu_features).toBeUndefined()
    writeHardwareCache(path, report)
    const loaded = hardwareInventory({ cachePath: path })
    expect(loaded.collected_at).toBe('2026-10-03T00:00:00.000Z')
    expect(loaded.from_cache).toBe(true)
    const text = readFileSync(path, 'utf8')
    expect(text).not.toContain('from_cache')
    expect(JSON.parse(text).collected_at).toBe('2026-10-03T00:00:00.000Z')
    if (process.platform === 'darwin') {
      expect(loaded.cpu_features?.length).toBeGreaterThan(0)
      expect(text).toContain('cpu_features')
    }
    if (process.platform === 'win32') expect(loaded.cpu_features).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})
