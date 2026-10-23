import { describe, expect, test } from 'bun:test'
import {
  acceptsTemperatureElement,
  celsiusReading,
  coreKinds,
  owningApp,
  parseGpuBusyPercent,
  parseGpuMemoryBytes,
  parseHwmonInput,
  thermalStateFromInt,
  HID_PAGE_POWER_DEVICE,
  HID_PAGE_SENSOR,
  HID_USAGE_DATA_ENV_TEMPERATURE,
  HID_USAGE_ENV_TEMPERATURE,
  HID_USAGE_PD_TEMPERATURE,
} from './sensors.ts'

describe('sensors', () => {
  test('temperature usages are the public sensor and power-device values', () => {
    expect(acceptsTemperatureElement(HID_PAGE_SENSOR, HID_USAGE_ENV_TEMPERATURE)).toBe(true)
    expect(acceptsTemperatureElement(HID_PAGE_SENSOR, HID_USAGE_DATA_ENV_TEMPERATURE)).toBe(true)
    expect(acceptsTemperatureElement(HID_PAGE_POWER_DEVICE, HID_USAGE_PD_TEMPERATURE)).toBe(true)
    expect(acceptsTemperatureElement(0x0c, 0x101)).toBe(false)
  })

  test('celsius keeps 0, prefers a real logical value over an unscaled 0, and drops kelvin', () => {
    expect(celsiusReading(0, 0)).toBe(0)
    expect(celsiusReading(0, 45)).toBe(45)
    expect(celsiusReading(36.5, 365)).toBe(36.5)
    expect(celsiusReading(300, undefined)).toBeUndefined()
    expect(celsiusReading(undefined, 45_000)).toBeUndefined()
    expect(celsiusReading(-40, undefined)).toBe(-40)
  })

  test('thermal state is the four-value enum', () => {
    expect(thermalStateFromInt(0)).toBe('nominal')
    expect(thermalStateFromInt(1)).toBe('fair')
    expect(thermalStateFromInt(2)).toBe('serious')
    expect(thermalStateFromInt(3)).toBe('critical')
    expect(thermalStateFromInt(4)).toBeUndefined()
  })

  test('core kinds follow named perflevels and are omitted when the counts do not cover the array', () => {
    expect(
      coreKinds(
        [
          { level: 0, logicalCpu: 4, name: 'Performance' },
          { level: 1, logicalCpu: 4, name: 'Efficiency' },
        ],
        8,
      ),
    ).toEqual([
      'performance',
      'performance',
      'performance',
      'performance',
      'efficiency',
      'efficiency',
      'efficiency',
      'efficiency',
    ])
    expect(coreKinds([{ level: 0, logicalCpu: 4, name: 'Performance' }], 8)).toBeUndefined()
    expect(coreKinds([{ level: 1, logicalCpu: 4, name: 'Efficiency' }], 4)).toBeUndefined()
  })

  test('owning app is the nearest bundle on the executable path', () => {
    expect(owningApp('/Applications/Safari.app/Contents/MacOS/Safari')).toBe('Safari')
    expect(owningApp('/Applications/Foo.app/Contents/Helpers/Bar.app/Contents/MacOS/Bar')).toBe('Bar')
    expect(owningApp('/usr/bin/ssh')).toBeUndefined()
    expect(owningApp('Safari')).toBeUndefined()
  })

  test('hwmon keeps a measured zero and names the chip', () => {
    expect(parseHwmonInput({ chip: 'coretemp', key: 'temp1_input', input: '0\n', label: 'Package id 0' })).toEqual({
      kind: 'temp',
      reading: { name: 'coretemp Package id 0', celsius: 0 },
    })
    expect(parseHwmonInput({ chip: 'nvme', key: 'temp1_input', input: '45123\n' })).toEqual({
      kind: 'temp',
      reading: { name: 'nvme temp1', celsius: 45.123 },
    })
    expect(parseHwmonInput({ chip: 'nct6779', key: 'fan1_input', input: '1200\n', label: 'fan1' })).toEqual({
      kind: 'fan',
      reading: { name: 'nct6779 fan1', rpm: 1200 },
    })
    expect(parseHwmonInput({ chip: 'nct6779', key: 'fan2_input', input: '0\n' })?.kind).toBe('fan')
    expect(parseHwmonInput({ chip: 'nct6779', key: 'fan2_input', input: '-1\n' })).toBeNull()
    expect(parseHwmonInput({ chip: 'nct6779', key: 'temp1_label', input: '1\n' })).toBeNull()
  })

  test('gpu sysfs percents stay in range and a measured 0 stays 0', () => {
    expect(parseGpuBusyPercent('0\n')).toBe(0)
    expect(parseGpuBusyPercent('100')).toBe(100)
    expect(parseGpuBusyPercent('101')).toBeNull()
    expect(parseGpuMemoryBytes('0')).toBe(0)
    expect(parseGpuMemoryBytes('4096')).toBe(4096)
    expect(parseGpuMemoryBytes('-1')).toBeNull()
  })
})
