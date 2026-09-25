import { describe, expect, test } from 'bun:test'
import { parsePmsetBatt, parseSwapUsage } from './darwin.ts'
import { optionalSystemStats } from './index.ts'
import { parseLinuxBattery, parseMeminfoSwap } from './linux.ts'
import type { PlatformSample } from './types.ts'

const sample = (over: Partial<PlatformSample> = {}): PlatformSample => ({
  cpuBrand: 'c',
  coreCount: 1,
  memoryTotal: 1,
  memoryUsed: 1,
  memoryFree: 0,
  netRxTotal: 0,
  netTxTotal: 0,
  diskTotal: 1,
  diskUsed: 0,
  diskFree: 1,
  uptimeSecs: 1,
  loadAvg: [0, 0, 0],
  hostname: 'h',
  osVersion: 'o',
  kernelVersion: 'k',
  procs: [],
  ...over,
})

describe('parseSwapUsage', () => {
  test('macOS vm.swapusage with megabyte units', () => {
    expect(parseSwapUsage('total = 2048.00M  used = 512.50M  free = 1535.50M  (encrypted)')).toEqual({
      total: 2048 * 1024 * 1024,
      used: Math.round(512.5 * 1024 * 1024),
    })
  })

  test('accepts the sysctl key prefix and a disabled swap', () => {
    expect(parseSwapUsage('vm.swapusage: total = 0.00M  used = 0.00M  free = 0.00M')).toEqual({
      total: 0,
      used: 0,
    })
  })

  test('gigabytes and bare bytes', () => {
    expect(parseSwapUsage('total = 1.5G used = 1024')).toEqual({
      total: Math.round(1.5 * 1024 ** 3),
      used: 1024,
    })
  })

  test('garbage is absent, not zero', () => {
    expect(parseSwapUsage('')).toBeNull()
    expect(parseSwapUsage('total = no used = 1M')).toBeNull()
  })
})

describe('parsePmsetBatt', () => {
  test('internal battery charging', () => {
    const text = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=1)\t85%; charging; 0:42 remaining present: true`
    expect(parsePmsetBatt(text)).toEqual({ chargePercent: 85, charging: true })
  })

  test('charged and not-charging are present but not charging', () => {
    // pmset glues the percent to the id: "(id=28967011)100%; charged;"
    expect(
      parsePmsetBatt(`Now drawing from 'AC Power'
 -InternalBattery-0 (id=28967011)100%; charged; 0:00 remaining present: true`),
    ).toEqual({ chargePercent: 100, charging: false })
    expect(
      parsePmsetBatt(`Now drawing from 'AC Power'
 -InternalBattery-0 (id=1) 100%; charged; 0:00 remaining present: true`),
    ).toEqual({ chargePercent: 100, charging: false })
    expect(
      parsePmsetBatt(`Now drawing from 'AC Power'
 -InternalBattery-0 (id=1) 95%; not charging; present: true`),
    ).toEqual({ chargePercent: 95, charging: false })
  })

  test('finishing charge still counts as charging', () => {
    expect(
      parsePmsetBatt(` -InternalBattery-0 99%; finishing charge; present: true`),
    ).toEqual({ chargePercent: 99, charging: true })
  })

  test('desktop with no battery line', () => {
    expect(parsePmsetBatt(`Now drawing from 'AC Power'\n`)).toBeNull()
  })

  test('prefers the internal battery over another percent line', () => {
    const text = `Now drawing from 'AC Power'
 -ExternalBattery-0 10%; discharging; present: true
 -InternalBattery-0 70%; charged; present: true`
    expect(parsePmsetBatt(text)).toEqual({ chargePercent: 70, charging: false })
  })
})

describe('linux swap and battery', () => {
  test('meminfo swap in kibibytes', () => {
    const text = `MemTotal: 1000 kB
SwapTotal:       2097148 kB
SwapFree:        1048574 kB
`
    expect(parseMeminfoSwap(text)).toEqual({
      total: 2097148 * 1024,
      used: (2097148 - 1048574) * 1024,
    })
  })

  test('missing SwapFree is not a zero used', () => {
    expect(parseMeminfoSwap('SwapTotal: 100 kB\n')).toBeNull()
  })

  test('battery status', () => {
    expect(parseLinuxBattery('73\n', 'Charging\n')).toEqual({ chargePercent: 73, charging: true })
    expect(parseLinuxBattery('100', 'Full')).toEqual({ chargePercent: 100, charging: false })
    expect(parseLinuxBattery('80', 'Not charging')).toEqual({ chargePercent: 80, charging: false })
    expect(parseLinuxBattery('nope', 'Charging')).toBeNull()
  })
})

describe('optionalSystemStats', () => {
  test('omits a half-measured pair and keeps charging=false', () => {
    expect(optionalSystemStats(sample({ swapTotal: 10 }))).toEqual({})
    expect(
      optionalSystemStats(sample({ batteryChargePercent: 40, batteryCharging: false })),
    ).toEqual({ battery_charge_percent: 40, battery_charging: false })
  })

  test('rounds swap bytes and charge percent', () => {
    expect(
      optionalSystemStats(
        sample({ swapTotal: 10.4, swapUsed: 2.6, batteryChargePercent: 33.34, batteryCharging: true }),
      ),
    ).toEqual({
      swap_total_bytes: 10,
      swap_used_bytes: 3,
      battery_charge_percent: 33.3,
      battery_charging: true,
    })
  })
})
