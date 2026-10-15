import type { HistoryRow } from './db.ts'

/**
 * Latest system sample as OpenMetrics gauges. Network fields are already
 * per-second rates in the store. No timestamp suffix: OpenMetrics and
 * Prometheus disagree on seconds versus milliseconds.
 */
export function renderOpenMetrics(row: HistoryRow): string {
  const gauges: [name: string, help: string, value: number][] = [
    ['sloppytop_cpu_usage_percent', 'Total CPU usage, 0-100', row.cpu_usage_total],
    ['sloppytop_memory_used_bytes', 'Memory used, bytes', row.memory_used],
    ['sloppytop_load1', 'Load average over 1 minute', row.load_1],
    ['sloppytop_network_rx_bytes_per_second', 'Host network receive rate', row.network_rx_bytes],
    ['sloppytop_network_tx_bytes_per_second', 'Host network transmit rate', row.network_tx_bytes],
    ['sloppytop_process_count', 'Process count in the sample', row.process_count],
  ]
  const lines = [`# sloppytop_sample_at ${row.at}`]
  for (const [name, help, value] of gauges) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`)
  }
  lines.push('# EOF')
  return lines.join('\n') + '\n'
}
