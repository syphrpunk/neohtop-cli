import { describe, expect, test } from 'bun:test'
import { buildSample } from './windows.ts'

const raw = {
  cpuBrand: 'Intel(R) Core(TM) Test',
  memoryTotalKb: 16_777_216, // 16 GiB in KB
  memoryFreeKb: 8_388_608,
  osCaption: 'Microsoft Windows 11 Pro',
  osVersion: '10.0.26100',
  uptimeSecs: 12_345,
  disks: [
    { Size: 1_000_000_000_000, FreeSpace: 400_000_000_000 },
    { Size: 500_000_000_000, FreeSpace: 100_000_000_000 },
  ],
  net: [
    { BytesReceivedPersec: 1_000_000, BytesSentPersec: 500_000 },
    { BytesReceivedPersec: 2_000_000, BytesSentPersec: 700_000 },
  ],
  procs: [
    {
      ProcessId: 4321,
      ParentProcessId: 4,
      Name: 'chrome.exe',
      WorkingSetSize: 250_000_000,
      VirtualSize: 2_000_000_000,
      ThreadCount: 32,
      CommandLine: '"C:\\Program Files\\chrome.exe" --type=renderer',
      KernelModeTime: 50_000_000, // 5s in 100ns units
      UserModeTime: 150_000_000, // 15s
      ReadTransferCount: 1_234_567,
      WriteTransferCount: 7_654_321,
      RuntimeSecs: 3600,
    },
    { Name: 'orphan-without-pid.exe' },
  ],
}

const ticks = [
  { busy: 500, total: 1000 },
  { busy: 300, total: 1000 },
]

describe('windows buildSample', () => {
  const sample = buildSample(raw, ticks, 'winbox')

  test('system fields', () => {
    expect(sample.cpuBrand).toBe('Intel(R) Core(TM) Test')
    expect(sample.coreCount).toBe(2)
    expect(sample.memoryTotal).toBe(16_777_216 * 1024)
    expect(sample.memoryUsed).toBe((16_777_216 - 8_388_608) * 1024)
    expect(sample.diskTotal).toBe(1_500_000_000_000)
    expect(sample.diskFree).toBe(500_000_000_000)
    expect(sample.netRxTotal).toBe(3_000_000)
    expect(sample.netTxTotal).toBe(1_200_000)
    expect(sample.loadAvg).toEqual([0, 0, 0])
    expect(sample.osVersion).toBe('Microsoft Windows 11 Pro')
    expect(sample.kernelVersion).toBe('10.0.26100')
    expect(sample.hostname).toBe('winbox')
  })

  test('process rows convert 100ns CPU time to 10ms ticks', () => {
    expect(sample.procs).toHaveLength(1) // pid-less row dropped
    const p = sample.procs[0]!
    expect(p.pid).toBe(4321)
    expect(p.cpuTicks).toBe(2000) // 20s total CPU = 2000 ticks at CLK_TCK=100
    expect(p.threads).toBe(32)
    expect(p.diskReadTotal).toBe(1_234_567)
    expect(p.command).toContain('--type=renderer')
    expect(p.runtimeSecs).toBe(3600)
  })
})
