import { describe, expect, test } from 'bun:test'
import type { SystemStats } from '../monitor/types.ts'
import { metricsResponse } from './metrics.ts'
import { renderSystemMetrics } from './openmetrics.ts'

const system = {
  cpu_usage_total: 1,
  cpu_usage_per_core: [1, 0],
  cpu_core_kinds: ['performance', 'efficiency'],
  memory_used: 10,
  process_count: 2,
  thermal_state: 'nominal',
  temperatures: [{ name: 'soc', celsius: 0 }],
  disk_devices: [{ name: 'disk0', read_bytes_per_s: 4, write_bytes_per_s: 5, read_iops: 1, write_iops: 1 }],
} as SystemStats

describe('metrics scrape', () => {
  test('renders measured zeros and a thermal-state label', () => {
    const text = renderSystemMetrics(system, '2026-10-23T00:00:00.000Z')
    expect(text).toContain('# sloppytop_sample_at 2026-10-23T00:00:00.000Z\n')
    expect(text).toContain('sloppytop_cpu_core_usage_percent{core="1",kind="efficiency"} 0\n')
    expect(text).toContain('sloppytop_temperature_celsius{sensor="soc"} 0\n')
    expect(text).toContain('sloppytop_disk_read_bytes_per_second{device="disk0"} 4\n')
    expect(text).toContain('sloppytop_thermal_state{state="nominal"} 1\n')
    expect(text).not.toMatch(/sloppytop_thermal_state \d/)
    expect(text).not.toContain('sloppytop_cpu_power_watts')
    expect(text.endsWith('# EOF\n')).toBe(true)
  })

  test('GET /metrics returns the text and other paths do not', async () => {
    const ok = await metricsResponse(new Request('http://127.0.0.1/metrics'), async () => system)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toContain('application/openmetrics-text')
    expect(await ok.text()).toContain('sloppytop_process_count 2\n')
    const missing = await metricsResponse(new Request('http://127.0.0.1/health'), async () => system)
    expect(missing.status).toBe(404)
    const posted = await metricsResponse(new Request('http://127.0.0.1/metrics', { method: 'POST' }), async () => system)
    expect(posted.status).toBe(405)
  })
})
