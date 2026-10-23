import { describe, expect, test } from 'bun:test'
import {
  collectFlags,
  defaultProbes,
  disabledRecordProbes,
  parseProbeList,
  probeEntries,
  projectProcesses,
  projectSystem,
} from './probes.ts'
import type { ProcessInfo, SystemStats } from './types.ts'

function system(): SystemStats {
  return {
    cpu_brand: 'Test',
    cpu_usage_per_core: [1, 2],
    cpu_usage_total: 1.5,
    core_count: 2,
    cpu_core_kinds: ['performance', 'efficiency'],
    memory_total: 100,
    memory_used: 40,
    memory_free: 60,
    memory_app_bytes: 10,
    uptime_secs: 5,
    load_avg: [0.1, 0.2, 0.3],
    network_rx_bytes: 8,
    network_tx_bytes: 9,
    disk_total_bytes: 1000,
    disk_used_bytes: 100,
    disk_free_bytes: 900,
    disk_devices: [{ name: 'disk0', read_bytes_per_s: 1, write_bytes_per_s: 2, read_iops: 1, write_iops: 1 }],
    hostname: 'host',
    os_version: 'test',
    kernel_version: 'test',
    process_count: 3,
    cpu_power_watts: 4,
    gpu_utilization_percent: 0,
    temperatures: [{ name: 'soc', celsius: 0 }],
    thermal_state: 'nominal',
    battery_charge_percent: 50,
    battery_charging: false,
    swap_total_bytes: 0,
    swap_used_bytes: 0,
  }
}

function process(command: string): ProcessInfo {
  return {
    pid: 1,
    ppid: 0,
    name: 'app',
    cpu_usage: 1,
    memory_bytes: 10,
    status: 'Running',
    user: 'me',
    command,
    runtime_secs: 1,
    disk_read_bytes: 0,
    disk_write_bytes: 0,
    gpu_time_ms: 3,
    owning_app: 'App',
  }
}

describe('probes', () => {
  test('an off probe is removed and a measured zero stays when the probe is on', () => {
    const probes = defaultProbes()
    probes.sensors = false
    probes.power = false
    const out = projectSystem(system(), probes)
    expect(out.temperatures).toBeUndefined()
    expect(out.thermal_state).toBeUndefined()
    expect(out.cpu_power_watts).toBeUndefined()
    expect(out.gpu_utilization_percent).toBe(0)
    expect(out.cpu_usage_total).toBe(1.5)
  })

  test('processes off drops the rows, and gpu off drops only gpu time', () => {
    const probes = defaultProbes()
    const row = process('secret --token=abc')
    probes.processes = false
    expect(projectProcesses([row], probes)).toEqual([])
    probes.processes = true
    probes.gpu = false
    expect(projectProcesses([row], probes)[0]?.gpu_time_ms).toBeUndefined()
    expect(projectProcesses([row], probes)[0]?.command).toBe('secret --token=abc')
  })

  test('the probe log keeps host numbers and leaves out the command line', () => {
    const probes = defaultProbes()
    probes.connections = false
    const text = JSON.stringify(probeEntries(system(), [process('secret --token=abc')], probes, '2026-10-23T00:00:00.000Z'))
    expect(text).not.toContain('secret')
    expect(text).not.toContain('token')
    expect(text).toContain('"probe":"cpu"')
    expect(text).toContain('"cpu_usage_total":1.5')
    expect(text).toContain('"thermal_state":"nominal"')
    expect(text).toContain('"count":1')
    expect(text).not.toContain('"probe":"connections"')
  })

  test('record names the probes the store cannot omit', () => {
    const probes = defaultProbes()
    probes.cpu = false
    probes.sensors = false
    expect(disabledRecordProbes(probes)).toEqual(['cpu'])
    expect(collectFlags(probes).sensors).toBe(false)
    expect(collectFlags(probes).power).toBe(true)
  })

  test('probe names reject an unknown token and keep a known one', () => {
    expect(parseProbeList(' cpu, no-such ,sensors')).toEqual({
      names: ['cpu', 'sensors'],
      unknown: ['no-such'],
    })
  })
})
