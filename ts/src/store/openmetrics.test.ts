import { describe, expect, test } from 'bun:test'
import type { HistoryRow } from './db.ts'
import { renderOpenMetrics } from './openmetrics.ts'

const row: HistoryRow = {
  id: 1,
  at: '2026-09-25T12:00:00.000Z',
  cpu_usage_total: 12.5,
  memory_used: 1000,
  memory_total: 2000,
  load_1: 1.5,
  network_rx_bytes: 10,
  network_tx_bytes: 4,
  process_count: 80,
}

describe('renderOpenMetrics', () => {
  test('emits the six gauges and the sample time as a comment', () => {
    const text = renderOpenMetrics(row)
    expect(text).toContain('# sloppytop_sample_at 2026-09-25T12:00:00.000Z\n')
    expect(text).toContain('# TYPE sloppytop_cpu_usage_percent gauge\nsloppytop_cpu_usage_percent 12.5\n')
    expect(text).toContain('sloppytop_network_rx_bytes_per_second 10\n')
    expect(text).toContain('sloppytop_process_count 80\n')
    expect(text.endsWith('# EOF\n')).toBe(true)
  })
})
