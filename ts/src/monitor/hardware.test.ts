import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  normalizeHardware,
  parseDarwinHardware,
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
  })

  test('the cache round-trips the allowlist and marks from_cache', () => {
    const dir = mkdtempSync(join(tmpdir(), 'neohtop-hw-'))
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
    rmSync(dir, { recursive: true, force: true })
  })
})
