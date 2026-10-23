import type { SystemStats } from '../monitor/types.ts'
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
  optionalGauge(lines, 'sloppytop_memory_wired_bytes', 'Wired memory, bytes', row.memory_wired_bytes)
  optionalGauge(lines, 'sloppytop_memory_compressed_bytes', 'Compressed memory, bytes', row.memory_compressed_bytes)
  optionalGauge(lines, 'sloppytop_memory_app_bytes', 'Application memory, bytes', row.memory_app_bytes)
  optionalGauge(lines, 'sloppytop_memory_cached_bytes', 'Cached memory, bytes', row.memory_cached_bytes)
  optionalGauge(lines, 'sloppytop_pageins_per_second', 'Page-ins per second', row.pageins_per_s)
  optionalGauge(lines, 'sloppytop_pageouts_per_second', 'Page-outs per second', row.pageouts_per_s)
  optionalGauge(lines, 'sloppytop_compressions_per_second', 'Memory compressions per second', row.compressions_per_s)
  optionalGauge(
    lines,
    'sloppytop_decompressions_per_second',
    'Memory decompressions per second',
    row.decompressions_per_s,
  )
  for (const sensor of row.temperatures ?? []) {
    labeledGauge(lines, 'sloppytop_temperature_celsius', 'Temperature, degrees Celsius', 'sensor', sensor.name, sensor.celsius)
  }
  for (const fan of row.fans ?? []) {
    labeledGauge(lines, 'sloppytop_fan_rpm', 'Fan speed, revolutions per minute', 'fan', fan.name, fan.rpm)
  }
  lines.push('# EOF')
  return lines.join('\n') + '\n'
}

/**
 * Live scrape of one system sample. Absent fields are omitted. A measured 0
 * is emitted. thermal_state is a label whose value is always 1, not a 0–3 scale.
 */
export function renderSystemMetrics(system: Partial<SystemStats>, at = new Date().toISOString()): string {
  const lines = [`# sloppytop_sample_at ${at}`]
  gauge(lines, 'sloppytop_cpu_usage_percent', 'Total CPU usage, 0-100', system.cpu_usage_total)
  const cores = system.cpu_usage_per_core ?? []
  const kinds = system.cpu_core_kinds
  const labeled = cores
    .map((value, index) => {
      const kind = kinds && kinds.length === cores.length ? kinds[index] : undefined
      const labels = kind ? `core="${index}",kind="${kind}"` : `core="${index}"`
      return { labels, value }
    })
    .filter((sample) => Number.isFinite(sample.value))
  if (labeled.length > 0) {
    lines.push(
      '# HELP sloppytop_cpu_core_usage_percent Per-core CPU usage, 0-100',
      '# TYPE sloppytop_cpu_core_usage_percent gauge',
    )
    for (const sample of labeled) lines.push(`sloppytop_cpu_core_usage_percent{${sample.labels}} ${sample.value}`)
  }
  gauge(lines, 'sloppytop_memory_used_bytes', 'Memory used, bytes', system.memory_used)
  gauge(lines, 'sloppytop_memory_total_bytes', 'Memory total, bytes', system.memory_total)
  gauge(lines, 'sloppytop_memory_wired_bytes', 'Wired memory, bytes', system.memory_wired_bytes)
  gauge(lines, 'sloppytop_memory_compressed_bytes', 'Compressed memory, bytes', system.memory_compressed_bytes)
  gauge(lines, 'sloppytop_memory_app_bytes', 'Application memory, bytes', system.memory_app_bytes)
  gauge(lines, 'sloppytop_memory_cached_bytes', 'Cached memory, bytes', system.memory_cached_bytes)
  gauge(lines, 'sloppytop_pageins_per_second', 'Page-ins per second', system.pageins_per_s)
  gauge(lines, 'sloppytop_pageouts_per_second', 'Page-outs per second', system.pageouts_per_s)
  gauge(lines, 'sloppytop_compressions_per_second', 'Memory compressions per second', system.compressions_per_s)
  gauge(lines, 'sloppytop_decompressions_per_second', 'Memory decompressions per second', system.decompressions_per_s)
  gauge(lines, 'sloppytop_load1', 'Load average over 1 minute', system.load_avg?.[0])
  gauge(lines, 'sloppytop_network_rx_bytes_per_second', 'Host network receive rate', system.network_rx_bytes)
  gauge(lines, 'sloppytop_network_tx_bytes_per_second', 'Host network transmit rate', system.network_tx_bytes)
  gauge(lines, 'sloppytop_process_count', 'Process count in the sample', system.process_count)
  gauge(lines, 'sloppytop_swap_used_bytes', 'Swap used, bytes', system.swap_used_bytes)
  gauge(lines, 'sloppytop_swap_total_bytes', 'Swap total, bytes', system.swap_total_bytes)
  gauge(lines, 'sloppytop_battery_charge_percent', 'Battery charge, percent', system.battery_charge_percent)
  if (system.battery_charging !== undefined) {
    gauge(lines, 'sloppytop_battery_charging', '1 when a battery is charging, 0 when it is present and not', system.battery_charging ? 1 : 0)
  }
  gauge(lines, 'sloppytop_psi_cpu_some_avg10', 'CPU PSI some avg10', system.psi_cpu_some_avg10)
  gauge(lines, 'sloppytop_psi_io_some_avg10', 'I/O PSI some avg10', system.psi_io_some_avg10)
  gauge(lines, 'sloppytop_psi_memory_some_avg10', 'Memory PSI some avg10', system.psi_memory_some_avg10)
  gauge(lines, 'sloppytop_cpu_power_watts', 'CPU package power, watts', system.cpu_power_watts)
  gauge(lines, 'sloppytop_gpu_power_watts', 'GPU package power, watts', system.gpu_power_watts)
  gauge(lines, 'sloppytop_ane_power_watts', 'ANE package power, watts', system.ane_power_watts)
  gauge(lines, 'sloppytop_dram_power_watts', 'DRAM package power, watts', system.dram_power_watts)
  gauge(lines, 'sloppytop_gpu_utilization_percent', 'GPU utilization, 0-100', system.gpu_utilization_percent)
  gauge(lines, 'sloppytop_gpu_memory_bytes', 'In-use GPU memory, bytes', system.gpu_memory_bytes)
  for (const device of system.disk_devices ?? []) {
    labeledGauge(lines, 'sloppytop_disk_read_bytes_per_second', 'Device read rate', 'device', device.name, device.read_bytes_per_s)
    labeledGauge(lines, 'sloppytop_disk_write_bytes_per_second', 'Device write rate', 'device', device.name, device.write_bytes_per_s)
  }
  for (const sensor of system.temperatures ?? []) {
    labeledGauge(lines, 'sloppytop_temperature_celsius', 'Temperature, degrees Celsius', 'sensor', sensor.name, sensor.celsius)
  }
  for (const fan of system.fans ?? []) {
    labeledGauge(lines, 'sloppytop_fan_rpm', 'Fan speed, revolutions per minute', 'fan', fan.name, fan.rpm)
  }
  if (system.thermal_state) {
    labeledGauge(lines, 'sloppytop_thermal_state', 'macOS thermal state. The value is 1. Not a temperature limit.', 'state', system.thermal_state, 1)
  }
  if (system.memory_pressure_level) {
    labeledGauge(
      lines,
      'sloppytop_memory_pressure',
      'macOS memorystatus note. The value is 1.',
      'level',
      system.memory_pressure_level,
      1,
    )
  }
  lines.push('# EOF')
  return lines.join('\n') + '\n'
}

function gauge(lines: string[], name: string, help: string, value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`)
}

function optionalGauge(lines: string[], name: string, help: string, value: number | undefined) {
  if (value === undefined) return
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`)
}

function labeledGauge(
  lines: string[],
  name: string,
  help: string,
  label: string,
  labelValue: string,
  value: number,
) {
  const series = `${name}{${label}="${escapeLabel(labelValue)}"}`
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${series} ${value}`)
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '').replace(/"/g, '\\"')
}
