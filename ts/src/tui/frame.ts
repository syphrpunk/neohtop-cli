// The stats strip and process table. Takes data and returns text.
// An omitted reading stays blank. A measured 0 is drawn as 0.

import type { SortKey } from '../filter/index.ts'
import { PROBE_NAMES } from '../monitor/probes.ts'
import type { CpuCoreKind, DiskDevice, ProcessInfo, SystemStats } from '../monitor/types.ts'
import { TUI_COLUMNS, type TuiColumn } from '../store/config.ts'
import { sparkline } from '../view/sparkline.ts'
import {
  clip,
  formatBytes,
  formatBytesCompact,
  formatPercent,
  formatRuntime,
  formatWatts,
  padLeft,
  padRight,
  plain,
  widthOf,
} from './format.ts'
import {
  toggleSort,
  visibleRows,
  type DisplayRow,
  type HardwareView,
  type ListenViewRow,
  type NetViewRow,
  type ScreenEffect,
  type ScreenState,
} from './state.ts'
import { THEME_NAMES, getTheme } from './theme.ts'

const MARKER = 2
const HISTORY_CAP = 120

interface ColumnSpec {
  label: string
  width: number
  sort?: SortKey
  align: 'left' | 'right'
}

const COLUMNS: Record<TuiColumn, ColumnSpec> = {
  pid: { label: 'PID', width: 7, sort: 'pid', align: 'right' },
  name: { label: 'Name', width: 16, sort: 'name', align: 'left' },
  command: { label: 'Command', width: 24, sort: 'command', align: 'left' },
  threads: { label: 'Thr', width: 5, sort: 'threads', align: 'right' },
  user: { label: 'User', width: 10, sort: 'user', align: 'left' },
  memory: { label: 'Memory', width: 8, sort: 'memory', align: 'right' },
  cpu: { label: 'CPU%', width: 7, sort: 'cpu', align: 'right' },
  status: { label: 'Status', width: 9, sort: 'status', align: 'left' },
  runtime: { label: 'Time', width: 8, sort: 'runtime', align: 'right' },
  disk: { label: 'Disk', width: 8, sort: 'disk', align: 'right' },
  virtual: { label: 'Virt', width: 8, align: 'right' },
  gpu: { label: 'GPU', width: 7, align: 'right' },
  footprint: { label: 'Foot', width: 8, align: 'right' },
  wakeups: { label: 'Wake', width: 7, align: 'right' },
  owning_app: { label: 'App', width: 12, align: 'left' },
  cgroup: { label: 'Cgroup', width: 16, align: 'left' },
}

export interface SampleHistory {
  cpu: number[]
  mem: number[]
  disk: number[]
  rx: number[]
  tx: number[]
  /** One series per core. Absent from a sample means that tick adds no point. */
  cores: number[][]
}

export interface ColumnSpan {
  id: TuiColumn
  x: number
  width: number
  sort?: SortKey
}

export interface Layout {
  headerLine: number
  columns: ColumnSpan[]
  bodyStart: number
  bodyRows: number
}

export interface Frame {
  text: string
  layout: Layout
  rows: DisplayRow[]
}

export interface Pointer {
  x: number
  y: number
  kind: 'down' | 'scroll'
  scroll?: 'up' | 'down'
}

export function emptyHistory(): SampleHistory {
  return { cpu: [], mem: [], disk: [], rx: [], tx: [], cores: [] }
}

/** Skip a point when the probe omitted the field. A measured 0 is kept. */
export function pushHistory(history: SampleHistory, system: Partial<SystemStats>): SampleHistory {
  const next: SampleHistory = {
    cpu: [...history.cpu],
    mem: [...history.mem],
    disk: [...history.disk],
    rx: [...history.rx],
    tx: [...history.tx],
    cores: history.cores.map((series) => [...series]),
  }
  if (system.cpu_usage_total !== undefined) next.cpu.push(system.cpu_usage_total)
  const mem = percent(system.memory_used, system.memory_total)
  if (mem !== undefined) next.mem.push(mem)
  const disk = percent(system.disk_used_bytes, system.disk_total_bytes)
  if (disk !== undefined) next.disk.push(disk)
  if (system.network_rx_bytes !== undefined) next.rx.push(system.network_rx_bytes)
  if (system.network_tx_bytes !== undefined) next.tx.push(system.network_tx_bytes)
  if (system.cpu_usage_per_core !== undefined) {
    const values = system.cpu_usage_per_core
    if (next.cores.length !== values.length) next.cores = values.map(() => [])
    for (let index = 0; index < values.length; index++) {
      const value = values[index]
      const series = next.cores[index] ?? []
      if (typeof value === 'number' && Number.isFinite(value)) series.push(value)
      next.cores[index] = series.length > HISTORY_CAP ? series.slice(-HISTORY_CAP) : series
    }
  }
  for (const key of ['cpu', 'mem', 'disk', 'rx', 'tx'] as const) {
    if (next[key].length > HISTORY_CAP) next[key] = next[key].slice(-HISTORY_CAP)
  }
  return next
}

export function compose(
  state: ScreenState,
  input: { processes: ProcessInfo[]; system: Partial<SystemStats>; history: SampleHistory },
): Frame {
  const width = Math.max(1, state.width)
  const height = Math.max(1, state.height)
  const view = visibleRows(state, input.processes)
  const fitted = fitColumns(state.columns, width)
  const lines: string[] = []
  const capacity = Math.max(0, height - 1)
  const add = (line: string): boolean => {
    if (lines.length >= capacity) return false
    lines.push(fit(line, width))
    return true
  }

  add(`sloppytop  ${getTheme(state.theme).label}`)

  let headerLine = -1
  let bodyStart = lines.length
  let bodyRows = 0
  if (state.overlay === 'none') {
    for (const line of stripLines(input.system, input.history, width, height)) {
      if (!add(line)) break
    }
    const header = headerLineText(state, fitted)
    if (add(header)) headerLine = lines.length - 1
    add(hairline(width))
    bodyStart = lines.length
    const budget = Math.max(0, capacity - lines.length - 1)
    bodyRows = budget
    const shown = windowRows(view.rows, state.scroll, budget)
    let drawn = 0
    if (shown.length === 0) {
      if (budget > 0 && add(emptyText(state, view.error))) drawn++
    } else {
      for (const row of shown) {
        if (!add(rowLine(state, row, fitted))) break
        drawn++
      }
    }
    while (drawn < budget && lines.length < capacity - 1) {
      if (!add('')) break
      drawn++
    }
    add(footerText(state, input.system, view.rows))
  } else {
    bodyStart = lines.length
    for (const line of framed(overlayTitle(state.overlay), overlayLines(state, input.processes), width)) {
      if (!add(line)) break
    }
  }

  const toolbar = fit(toolbarText(state, view.rows, input.processes.length, view.error), width)
  const text = [...lines, toolbar].slice(0, height).join('\n')
  return {
    text,
    rows: view.rows,
    layout: {
      headerLine,
      columns: spans(fitted),
      bodyStart,
      bodyRows,
    },
  }
}

export function applyPointer(
  state: ScreenState,
  layout: Layout,
  rows: DisplayRow[],
  pointer: Pointer,
): { state: ScreenState; effect?: ScreenEffect } {
  if (state.overlay !== 'none') {
    if (pointer.kind !== 'down') return { state }
    if (state.overlay === 'columns' || state.overlay === 'theme') {
      return {
        state: { ...state, overlay: 'none' },
        effect: { tui: { columns: state.columns, theme: state.theme, refreshMs: state.refreshMs } },
      }
    }
    return { state: { ...state, overlay: 'none' } }
  }

  if (pointer.kind === 'scroll') {
    const delta = pointer.scroll === 'up' ? -3 : 3
    const max = Math.max(0, rows.length - layout.bodyRows)
    const scroll = Math.min(max, Math.max(0, state.scroll + delta))
    return { state: { ...state, scroll } }
  }

  if (pointer.y === layout.headerLine) {
    const span = layout.columns.find((column) => pointer.x >= column.x && pointer.x < column.x + column.width)
    if (!span?.sort) return { state }
    return { state: toggleSort(state, span.sort) }
  }

  if (pointer.y >= layout.bodyStart && pointer.y < layout.bodyStart + layout.bodyRows) {
    const row = rows[state.scroll + (pointer.y - layout.bodyStart)]
    if (row?.kind === 'process') return { state: { ...state, selectedPid: row.proc.pid } }
  }
  return { state }
}

function percent(used: number | undefined, total: number | undefined): number | undefined {
  if (used === undefined || total === undefined || !(total > 0)) return undefined
  return (used / total) * 100
}

function fit(text: string, width: number): string {
  return padRight(text, width)
}

function meter(
  label: string,
  value: string,
  series: number[],
  max: number,
  width: number,
  drawSpark: boolean,
): string {
  const head = `${label}  ${value}`
  const room = width - widthOf(head) - 2
  if (!drawSpark || room < 1 || series.length === 0) return head
  return `${head}  ${sparkline(series, { max, width: room })}`
}

function cpuValue(system: Partial<SystemStats>): string {
  if (system.cpu_usage_total === undefined) return '—'
  return formatPercent(system.cpu_usage_total)
}

function memValue(system: Partial<SystemStats>): string {
  if (system.memory_used === undefined || system.memory_total === undefined) return '—'
  return `${formatBytes(system.memory_used)} / ${formatBytes(system.memory_total)}`
}

function diskValue(system: Partial<SystemStats>): string {
  if (system.disk_used_bytes === undefined || system.disk_total_bytes === undefined) return '—'
  return `${formatBytes(system.disk_used_bytes)} / ${formatBytes(system.disk_total_bytes)}`
}

/** Rows under the title and above the table. The four meters are always here. Optional readings are not. */
export function stripLineCount(system: Partial<SystemStats>, width: number, height = 24): number {
  return stripLines(system, emptyHistory(), width, height).length
}

function stripLines(system: Partial<SystemStats>, history: SampleHistory, width: number, height: number): string[] {
  if (width >= 96 && height >= 30) return panelStrip(system, history, width, height)
  return compactStrip(system, history, width, height)
}

/** Short terminals keep one labeled band so the process table still has rows. */
function compactStrip(system: Partial<SystemStats>, history: SampleHistory, width: number, height: number): string[] {
  const half = Math.max(8, Math.floor((width - 2) / 2))
  const required = [
    band('system', width),
    ...joinPair(
      meter('CPU', cpuValue(system), history.cpu, 100, half, system.cpu_usage_total !== undefined),
      meter('MEM', memValue(system), history.mem, 100, half, system.memory_used !== undefined && system.memory_total !== undefined),
      width,
    ),
    meter(
      'DSK',
      diskValue(system),
      history.disk,
      100,
      width,
      system.disk_used_bytes !== undefined && system.disk_total_bytes !== undefined,
    ),
    ...netRows(system, history, width),
  ]
  if (showCores(system, width)) required.push(coresLine(system))
  const optional = [
    ...powerRows(system, width),
    ...thermalRows(system, width),
    ...pressureRows(system, width),
    ...memoryRows(system, width),
    ...gpuRows(system, width),
    ...sensorRows(system, width),
    ...batteryRows(system, width),
    ...swapRows(system, width),
    ...diskRows(system, width),
    ...hostRows(system, width),
  ]
  const max = Math.max(4, height - 13)
  return fitBudget(required, optional, max)
}

/**
 * Wide terminals give each probe its own box. Readings stay one labeled cell,
 * not a wrapped sentence. cpu, mem, disk, and net are always present.
 */
function panelStrip(system: Partial<SystemStats>, history: SampleHistory, width: number, height: number): string[] {
  const columns = width >= 120 ? 3 : 2
  const budget = Math.max(6, height - 14)
  const slotWidths = columnWidths(width, Array.from({ length: columns }, () => 1))
  const contentW = Math.max(8, (slotWidths[0] ?? 12) - 4)
  const fitted = fitProbePanels(probePanels(system, history, contentW), columns, budget)
  const lines: string[] = []
  for (let index = 0; index < fitted.panels.length; index += columns) {
    const row = fitted.panels.slice(index, index + columns)
    const boxes = alignPanels(
      row.map((panel, column) => {
        const panelWidth = slotWidths[column] ?? 10
        const inner = Math.max(1, panelWidth - 4)
        return box(panel.title, panel.lines.map((line) => clip(line, inner)), panelWidth)
      }),
    )
    const rowHeight = boxes[0]?.length ?? 0
    while (boxes.length < columns) boxes.push(blankColumn(slotWidths[boxes.length] ?? 10, rowHeight))
    lines.push(...zipPanels(boxes))
  }
  if (fitted.dropped.length > 0) lines.push(clip(`also  ${fitted.dropped.join('  ')}`, width))
  return lines
}

interface ProbePanel {
  title: string
  lines: string[]
}

function probePanels(system: Partial<SystemStats>, history: SampleHistory, contentW: number): ProbePanel[] {
  const panels: ProbePanel[] = [
    { title: 'cpu', lines: cpuPanel(system, history, contentW) },
    { title: 'mem', lines: memPanel(system, history, contentW) },
    { title: 'disk', lines: diskPanel(system, history, contentW) },
    { title: 'net', lines: netRows(system, history, contentW) },
  ]
  const extra: ProbePanel[] = [
    { title: 'power', lines: powerRows(system, contentW) },
    { title: 'gpu', lines: gpuRows(system, contentW) },
    { title: 'sensors', lines: [...thermalRows(system, contentW), ...sensorRows(system, contentW)] },
    { title: 'pressure', lines: pressureRows(system, contentW) },
    { title: 'battery', lines: batteryRows(system, contentW) },
    { title: 'swap', lines: swapRows(system, contentW) },
    { title: 'host', lines: hostRows(system, contentW) },
  ]
  for (const panel of extra) if (panel.lines.length > 0) panels.push(panel)
  return panels
}

function fitProbePanels(
  panels: ProbePanel[],
  columns: number,
  budget: number,
): { panels: ProbePanel[]; dropped: string[] } {
  let cap = 12
  let current = capPanels(panels, cap)
  while (cap > 3 && panelRowsHeight(current, columns) > budget) {
    cap -= 1
    current = capPanels(panels, cap)
  }
  const dropped: string[] = []
  while (panelRowsHeight(current, columns) > budget && current.length > 4) {
    const panel = current.pop()
    if (panel) dropped.unshift(panel.title)
  }
  return { panels: current, dropped }
}

function capPanels(panels: ProbePanel[], cap: number): ProbePanel[] {
  return panels.map((panel) => {
    if (panel.lines.length <= cap) return panel
    const kept = panel.lines.slice(0, Math.max(1, cap - 1))
    kept.push(`+${panel.lines.length - kept.length} more`)
    return { title: panel.title, lines: kept }
  })
}

function panelRowsHeight(panels: ProbePanel[], columns: number): number {
  let total = 0
  for (let index = 0; index < panels.length; index += columns) {
    const row = panels.slice(index, index + columns)
    total += Math.max(1, ...row.map((panel) => panel.lines.length + 2))
  }
  return total
}

function blankColumn(width: number, height: number): string[] {
  const line = ' '.repeat(Math.max(0, width))
  return Array.from({ length: Math.max(1, height) }, () => line)
}

function cpuPanel(system: Partial<SystemStats>, history: SampleHistory, contentW: number): string[] {
  const lines = [meter('CPU', cpuValue(system), history.cpu, 100, contentW, system.cpu_usage_total !== undefined)]
  const cores = system.cpu_usage_per_core
  if (!cores || cores.length === 0) return lines
  const kinds = system.cpu_core_kinds
  const labeled = !!kinds && kinds.length === cores.length
  const shown = Math.min(cores.length, 16)
  const colW = Math.max(6, Math.floor((contentW - 2) / 2))
  for (let index = 0; index < shown; index += 2) {
    const left = coreCell(system, history, index, labeled, colW)
    const right = index + 1 < shown ? coreCell(system, history, index + 1, labeled, colW) : ''
    lines.push(...joinPair(left, right, contentW))
  }
  if (cores.length > 16) lines.push(`+${cores.length - 16} cores`)
  return lines
}

function coreCell(
  system: Partial<SystemStats>,
  history: SampleHistory,
  index: number,
  labeled: boolean,
  colW: number,
): string {
  const value = system.cpu_usage_per_core?.[index]
  const pct = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(0) : '—'
  const mark = labeled ? kindMark(system.cpu_core_kinds?.[index]) : ''
  const series = history.cores[index] ?? []
  const label = `c${index}`
  const reading = `${pct}${mark}`
  const sparkW = colW - widthOf(label) - widthOf(reading) - 2
  if (sparkW < 3 || series.length === 0) return `${label} ${reading}`
  return `${label} ${sparkline(series, { max: 100, width: sparkW })} ${reading}`
}

function memPanel(system: Partial<SystemStats>, history: SampleHistory, contentW: number): string[] {
  return [
    meter(
      'MEM',
      memValue(system),
      history.mem,
      100,
      contentW,
      system.memory_used !== undefined && system.memory_total !== undefined,
    ),
    ...memoryRows(system, contentW),
  ]
}

function diskPanel(system: Partial<SystemStats>, history: SampleHistory, contentW: number): string[] {
  const lines = [
    meter(
      'DSK',
      diskValue(system),
      history.disk,
      100,
      contentW,
      system.disk_used_bytes !== undefined && system.disk_total_bytes !== undefined,
    ),
  ]
  if (system.disk_free_bytes !== undefined) lines.push(factLine({ label: 'free', value: formatBytes(system.disk_free_bytes) }, contentW))
  lines.push(...diskRows(system, contentW))
  return lines
}

function fitBudget(required: string[], optional: string[], max: number): string[] {
  if (required.length >= max) return required.slice(0, max)
  const lines = [...required]
  for (const line of optional) {
    if (lines.length >= max) return lines
    lines.push(line)
  }
  return lines
}

function joinPair(left: string, right: string, width: number): string[] {
  if (!right) return left ? [left] : []
  if (!left) return [right]
  const joined = `${left}  ${right}`
  if (widthOf(joined) <= width) return [joined]
  return [left, right]
}

function columnWidths(width: number, flexes: number[]): number[] {
  const gaps = Math.max(0, flexes.length - 1)
  const avail = Math.max(flexes.length, width - gaps)
  const total = flexes.reduce((sum, flex) => sum + flex, 0)
  const widths: number[] = []
  let used = 0
  flexes.forEach((flex, index) => {
    if (index === flexes.length - 1) widths.push(Math.max(1, avail - used))
    else {
      const column = Math.max(1, Math.floor((avail * flex) / total))
      widths.push(column)
      used += column
    }
  })
  return widths
}

function zipPanels(panels: string[][]): string[] {
  const height = Math.max(0, ...panels.map((panel) => panel.length))
  const lines: string[] = []
  for (let index = 0; index < height; index++) {
    lines.push(panels.map((panel) => panel[index] ?? '').join(' '))
  }
  return lines
}

function alignPanels(panels: string[][]): string[][] {
  const height = Math.max(0, ...panels.map((panel) => panel.length))
  return panels.map((panel) => {
    if (panel.length >= height) return panel
    const sample = panel[0] ?? ''
    const empty = `│ ${' '.repeat(Math.max(0, widthOf(sample) - 4))} │`
    const bottom = panel[panel.length - 1] ?? empty
    const mid = panel.slice(0, -1)
    while (mid.length + 1 < height) mid.push(empty)
    return [...mid, bottom]
  })
}

function box(title: string, body: string[], width: number): string[] {
  const contentW = Math.max(0, width - 4)
  const rows = (body.length > 0 ? body : ['']).map((line) => `│ ${padRight(line, contentW)} │`)
  return [band(title, width), ...rows, bandBottom(width)]
}

function band(title: string, width: number): string {
  if (width <= 0) return ''
  const label = title ? ` ${title} ` : ''
  const dashes = width - 3 - widthOf(label)
  if (dashes < 1) return clip(`╭─${label}╮`, width)
  return `╭─${label}${'─'.repeat(dashes)}╮`
}

function bandBottom(width: number): string {
  if (width < 2) return clip('╰╯', width)
  return `╰${'─'.repeat(width - 2)}╯`
}

function hairline(width: number): string {
  return '─'.repeat(Math.max(1, width))
}

const LABEL_W = 8

interface Fact {
  label: string
  value: string
  graphic?: string
}

function factLine(fact: Fact, width: number): string {
  const label = padRight(clip(fact.label, LABEL_W), Math.min(LABEL_W, Math.max(0, width)))
  let rest = Math.max(0, width - widthOf(label))
  const graphic = fact.graphic ?? ''
  if (graphic && rest > widthOf(graphic) + 1) {
    rest -= widthOf(graphic) + 1
    return clip(`${label}${graphic} ${clip(fact.value, rest)}`, width)
  }
  return clip(`${label}${clip(fact.value, rest)}`, width)
}

/** One fact per row. Two facts on one row move every row under them when a reading appears or disappears. */
function stackFacts(facts: Fact[], width: number): string[] {
  return facts.map((fact) => factLine(fact, width))
}

function usageBar(pct: number, width: number): string {
  if (width <= 0 || !Number.isFinite(pct)) return ''
  const clamped = Math.max(0, Math.min(100, pct)) / 100
  const exact = clamped * width
  const full = Math.floor(exact)
  const half = exact - full >= 0.5 && full < width
  let bar = '⣿'.repeat(full)
  if (half) bar += '⡇'
  while ([...bar].length < width) bar += '⠶'
  return [...bar].slice(0, width).join('')
}

function memoryRows(system: Partial<SystemStats>, width: number): string[] {
  const facts: Fact[] = []
  const add = (label: string, value: number | undefined) => {
    if (value === undefined) return
    facts.push({ label, value: formatBytes(value) })
  }
  add('wired', system.memory_wired_bytes)
  add('comp', system.memory_compressed_bytes)
  add('app', system.memory_app_bytes)
  add('cache', system.memory_cached_bytes)
  add('free', system.memory_free)
  const lines = stackFacts(facts, width)
  const pages: Fact[] = []
  const addRate = (label: string, value: number | undefined) => {
    if (value === undefined) return
    pages.push({ label, value: `${formatRate(value)}/s` })
  }
  addRate('in', system.pageins_per_s)
  addRate('out', system.pageouts_per_s)
  addRate('cmp', system.compressions_per_s)
  addRate('dec', system.decompressions_per_s)
  lines.push(...stackFacts(pages, width))
  return lines
}

function diskRows(system: Partial<SystemStats>, width: number): string[] {
  const devices = system.disk_devices ?? []
  const lines: string[] = []
  for (const device of devices.slice(0, 2)) lines.push(...deviceRows(device, width))
  if (devices.length > 2) lines.push(`+${devices.length - 2} disks`)
  return lines
}

function deviceRows(device: DiskDevice, width: number): string[] {
  const lines = [clip(plain(device.name), width), directionRow('read', device, width), directionRow('write', device, width)]
  const merge = sideRow('merge', device.read_merges_per_s, device.write_merges_per_s, '/s', width)
  if (merge) lines.push(merge)
  const size = sizeRow(device, width)
  if (size) lines.push(size)
  return lines
}

function directionRow(dir: 'read' | 'write', device: DiskDevice, width: number): string {
  const bytes = dir === 'read' ? device.read_bytes_per_s : device.write_bytes_per_s
  const iops = dir === 'read' ? device.read_iops : device.write_iops
  const latency = dir === 'read' ? device.read_latency_ms : device.write_latency_ms
  const parts = [`${formatBytesCompact(bytes)}/s`, `${formatRate(iops)} iops`]
  if (latency !== undefined) parts.push(formatMs(latency))
  return factLine({ label: dir, value: parts.join('  ') }, width)
}

function sideRow(
  label: string,
  read: number | undefined,
  write: number | undefined,
  suffix: string,
  width: number,
): string | undefined {
  if (read === undefined && write === undefined) return undefined
  const parts = [
    read === undefined ? '' : `r ${formatRate(read)}${suffix}`,
    write === undefined ? '' : `w ${formatRate(write)}${suffix}`,
  ].filter((part) => part !== '')
  return factLine({ label, value: parts.join('  ') }, width)
}

function sizeRow(device: DiskDevice, width: number): string | undefined {
  if (device.read_request_bytes === undefined && device.write_request_bytes === undefined) return undefined
  const parts = [
    device.read_request_bytes === undefined ? '' : `r ${formatBytesCompact(device.read_request_bytes)}`,
    device.write_request_bytes === undefined ? '' : `w ${formatBytesCompact(device.write_request_bytes)}`,
  ].filter((part) => part !== '')
  return factLine({ label: 'size', value: parts.join('  ') }, width)
}

function hostRows(system: Partial<SystemStats>, width: number): string[] {
  const facts: Fact[] = []
  const load = loadNumbers(system.load_avg)
  if (load) facts.push({ label: 'load', value: load })
  if (system.uptime_secs !== undefined) facts.push({ label: 'up', value: formatRuntime(system.uptime_secs) })
  if (system.hostname) facts.push({ label: 'host', value: plain(system.hostname) })
  if (system.os_version) facts.push({ label: 'os', value: plain(system.os_version) })
  if (system.kernel_version) facts.push({ label: 'kernel', value: plain(system.kernel_version) })
  if (system.process_count !== undefined) facts.push({ label: 'procs', value: String(system.process_count) })
  if (system.cpu_brand) facts.push({ label: 'chip', value: plain(system.cpu_brand) })
  if ((system.cpu_usage_per_core?.length ?? 0) === 0 && system.core_count !== undefined) {
    facts.push({ label: 'cores', value: String(system.core_count) })
  }
  return stackFacts(facts, width)
}

function loadNumbers(load: SystemStats['load_avg'] | undefined): string | undefined {
  if (!load || load.length !== 3) return undefined
  if (!load.every((value) => typeof value === 'number' && Number.isFinite(value))) return undefined
  return load.map((value) => value.toFixed(2)).join(' ')
}

function powerRows(system: Partial<SystemStats>, width: number): string[] {
  const facts: Fact[] = []
  const add = (label: string, value: number | undefined) => {
    if (value === undefined) return
    facts.push({ label, value: formatWatts(value) })
  }
  add('cpu', system.cpu_power_watts)
  add('gpu', system.gpu_power_watts)
  add('ane', system.ane_power_watts)
  add('dram', system.dram_power_watts)
  return stackFacts(facts, width)
}

function gpuRows(system: Partial<SystemStats>, width: number): string[] {
  const lines: string[] = []
  if (system.gpu_utilization_percent !== undefined) {
    const pct = system.gpu_utilization_percent
    lines.push(factLine({ label: 'gpu', value: formatPercent(pct), graphic: width >= 28 ? usageBar(pct, 10) : undefined }, width))
  }
  const extra: Fact[] = []
  if (system.gpu_renderer_utilization_percent !== undefined) {
    extra.push({ label: 'render', value: formatPercent(system.gpu_renderer_utilization_percent) })
  }
  if (system.gpu_tiler_utilization_percent !== undefined) {
    extra.push({ label: 'tiler', value: formatPercent(system.gpu_tiler_utilization_percent) })
  }
  lines.push(...stackFacts(extra, width))
  if (system.gpu_memory_bytes !== undefined) lines.push(factLine({ label: 'vram', value: formatBytes(system.gpu_memory_bytes) }, width))
  return lines
}

function sensorRows(system: Partial<SystemStats>, width: number): string[] {
  const facts: Fact[] = []
  for (const reading of (system.temperatures ?? []).slice(0, 8)) {
    facts.push({ label: plain(reading.name), value: formatCelsius(reading.celsius) })
  }
  for (const fan of (system.fans ?? []).slice(0, 4)) {
    facts.push({ label: plain(fan.name), value: formatRpm(fan.rpm) })
  }
  const lines = stackFacts(facts, width)
  const hiddenTemps = Math.max(0, (system.temperatures?.length ?? 0) - 8)
  const hiddenFans = Math.max(0, (system.fans?.length ?? 0) - 4)
  const hidden = hiddenTemps + hiddenFans
  if (hidden > 0) lines.push(`+${hidden} sensors`)
  return lines
}

function thermalRows(system: Partial<SystemStats>, _width: number): string[] {
  const state = system.thermal_state
  if (state !== 'nominal' && state !== 'fair' && state !== 'serious' && state !== 'critical') return []
  return [`thermal  ${state}`]
}

function pressureRows(system: Partial<SystemStats>, width: number): string[] {
  const lines: string[] = []
  const level = system.memory_pressure_level
  if (level === 'normal' || level === 'warning' || level === 'critical') lines.push(`pressure  ${level}`)
  const facts: Fact[] = []
  const add = (label: string, value: number | undefined) => {
    if (value === undefined) return
    facts.push({ label, value: formatPercent(value) })
  }
  add('cpu', system.psi_cpu_some_avg10)
  add('io', system.psi_io_some_avg10)
  add('mem', system.psi_memory_some_avg10)
  lines.push(...stackFacts(facts, width))
  return lines
}

function batteryRows(system: Partial<SystemStats>, width: number): string[] {
  const lines: string[] = []
  if (system.battery_charge_percent !== undefined) {
    const charge = system.battery_charge_percent
    const value = Number.isFinite(charge) ? (charge === 0 ? '0%' : `${charge.toFixed(0)}%`) : '—'
    const graphic = Number.isFinite(charge) && width >= 28 ? usageBar(charge, 10) : undefined
    lines.push(factLine({ label: 'charge', value, graphic }, width))
  }
  if (system.battery_charging !== undefined) {
    lines.push(factLine({ label: 'state', value: system.battery_charging ? 'charging' : 'not charging' }, width))
  }
  return lines
}

function swapRows(system: Partial<SystemStats>, width: number): string[] {
  const used = system.swap_used_bytes
  const total = system.swap_total_bytes
  if (used === undefined && total === undefined) return []
  const value =
    used !== undefined && total !== undefined
      ? `${formatBytes(used)} / ${formatBytes(total)}`
      : formatBytes(used ?? total ?? 0)
  const share = percent(used, total)
  const graphic = share !== undefined && width >= 28 ? usageBar(share, 10) : undefined
  return [factLine({ label: 'swap', value, graphic }, width)]
}

function netRows(system: Partial<SystemStats>, history: SampleHistory, width: number): string[] {
  return [
    rateRow('rx', system.network_rx_bytes, history.rx, width),
    rateRow('tx', system.network_tx_bytes, history.tx, width),
  ]
}

function rateRow(label: string, bytes: number | undefined, series: number[], width: number): string {
  if (bytes === undefined) return factLine({ label, value: '—' }, width)
  const value = `${formatBytesCompact(bytes)}/s`
  const room = width - LABEL_W - widthOf(value) - 2
  const graphic = room >= 4 && series.length > 0 ? sparkline(series, { width: Math.min(room, 24) }) : undefined
  return factLine({ label, value, graphic }, width)
}

function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  return abs >= 100 ? value.toFixed(0) : value.toFixed(1)
}

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0ms'
  return `${value.toFixed(1)}ms`
}

function formatCelsius(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0°C'
  return `${value.toFixed(1)}°C`
}

function formatRpm(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0 rpm'
  return `${Math.round(value)} rpm`
}

function showCores(system: Partial<SystemStats>, width: number): boolean {
  return width >= 60 && (system.cpu_usage_per_core?.length ?? 0) > 0
}

function coresLine(system: Partial<SystemStats>): string {
  const cores = system.cpu_usage_per_core ?? []
  const kinds = system.cpu_core_kinds
  const labeled = !!kinds && kinds.length === cores.length
  const body = cores
    .map((core, index) => {
      const value = Number.isFinite(core) ? core.toFixed(0) : '—'
      if (!labeled) return value
      return `${value}${kindMark(kinds?.[index])}`
    })
    .join(' ')
  return `cores  ${body}`
}

function kindMark(kind: CpuCoreKind | undefined): string {
  if (kind === 'performance') return 'P'
  if (kind === 'efficiency') return 'E'
  return '?'
}

const COLUMN_GAP = 1

function fitColumns(requested: TuiColumn[], width: number): { id: TuiColumn; width: number }[] {
  let cols = (requested.length > 0 ? requested : (['pid', 'name'] as TuiColumn[])).filter((id) => COLUMNS[id])
  const widths = new Map<TuiColumn, number>(cols.map((id) => [id, COLUMNS[id].width]))
  const sum = () =>
    MARKER + cols.reduce((total, id) => total + (widths.get(id) ?? 0), 0) + Math.max(0, cols.length - 1) * COLUMN_GAP
  const shrink = (id: TuiColumn, min: number) => {
    while (sum() > width && cols.includes(id) && (widths.get(id) ?? 0) > min) {
      widths.set(id, (widths.get(id) ?? 0) - 1)
    }
  }
  shrink('command', 8)
  while (sum() > width) {
    const drop = [...cols].reverse().find((id) => id !== 'pid' && id !== 'name')
    if (!drop) break
    cols = cols.filter((id) => id !== drop)
    widths.delete(drop)
  }
  shrink('command', 1)
  if (cols.includes('command') && sum() > width) {
    cols = cols.filter((id) => id !== 'command')
    widths.delete('command')
  }
  shrink('name', 1)
  shrink('pid', 1)
  return cols.map((id) => ({ id, width: Math.max(1, widths.get(id) ?? 1) }))
}

function spans(fitted: { id: TuiColumn; width: number }[]): ColumnSpan[] {
  let x = MARKER
  return fitted.map((column, index) => {
    const span: ColumnSpan = { id: column.id, x, width: column.width, sort: COLUMNS[column.id].sort }
    x += column.width + (index < fitted.length - 1 ? COLUMN_GAP : 0)
    return span
  })
}

function headerLineText(state: ScreenState, fitted: { id: TuiColumn; width: number }[]): string {
  const cells = fitted.map((column) => {
    const spec = COLUMNS[column.id]
    const mark = state.sortBy === spec.sort ? (state.sortOrder === 'asc' ? '^' : 'v') : ''
    return headerCell(spec.label, column.width, mark)
  })
  return `  ${cells.join(' ')}`
}

function headerCell(label: string, width: number, mark: string): string {
  if (!mark) return padRight(label, width)
  if (width === 1) return mark
  return padRight(label, width - 1) + mark
}

function rowLine(state: ScreenState, row: DisplayRow, fitted: { id: TuiColumn; width: number }[]): string {
  if (row.kind === 'missing') return padRight(`  ? ${row.pin}`, state.width)
  const selected = row.proc.pid === state.selectedPid
  const marker = selected && row.pinned ? '>*' : selected ? '> ' : row.pinned ? '* ' : '  '
  const cells = fitted.map((column) => cell(column.id, row.proc, row.prefix, column.width))
  return marker + cells.join(' ')
}

function cell(id: TuiColumn, proc: ProcessInfo, prefix: string, width: number): string {
  const spec = COLUMNS[id]
  const text = cellText(id, proc, prefix)
  return spec.align === 'right' ? padLeft(text, width) : padRight(text, width)
}

function cellText(id: TuiColumn, proc: ProcessInfo, prefix: string): string {
  switch (id) {
    case 'pid':
      return String(proc.pid)
    case 'name':
      return plain(prefix + proc.name)
    case 'command':
      return plain(proc.command)
    case 'threads':
      return proc.threads === undefined ? '' : String(proc.threads)
    case 'user':
      return plain(proc.user)
    case 'memory':
      return formatBytesCompact(proc.memory_bytes)
    case 'cpu':
      return Number.isFinite(proc.cpu_usage) ? proc.cpu_usage.toFixed(1) : ''
    case 'status':
      return plain(proc.status)
    case 'runtime':
      return formatRuntime(proc.runtime_secs)
    case 'disk':
      return formatBytesCompact(proc.disk_read_bytes + proc.disk_write_bytes)
    case 'virtual':
      return proc.virtual_memory_bytes === undefined ? '' : formatBytesCompact(proc.virtual_memory_bytes)
    case 'gpu':
      return proc.gpu_time_ms === undefined ? '' : proc.gpu_time_ms.toFixed(1)
    case 'footprint':
      return proc.phys_footprint_bytes === undefined ? '' : formatBytesCompact(proc.phys_footprint_bytes)
    case 'wakeups':
      return proc.idle_wakeups_per_s === undefined ? '' : proc.idle_wakeups_per_s.toFixed(1)
    case 'owning_app':
      return proc.owning_app === undefined ? '' : plain(proc.owning_app)
    case 'cgroup':
      return proc.cgroup === undefined ? '' : plain(proc.cgroup)
    default:
      return ''
  }
}

function windowRows(rows: DisplayRow[], scroll: number, budget: number): DisplayRow[] {
  if (budget <= 0) return []
  const max = Math.max(0, rows.length - budget)
  const start = Math.min(Math.max(0, scroll), max)
  return rows.slice(start, start + budget)
}

function emptyText(state: ScreenState, error: string): string {
  if (state.processesOff) return 'processes probe is off'
  if (error) return error
  if (state.waiting) return 'sampling…'
  return 'no processes'
}

function overlayLines(state: ScreenState, processes: ProcessInfo[]): string[] {
  if (state.overlay === 'help') return helpLines()
  if (state.overlay === 'kill') return killLines(state, processes)
  if (state.overlay === 'detail') return detailLines(state, processes)
  if (state.overlay === 'columns') return columnLines(state)
  if (state.overlay === 'theme') return themeLines(state)
  if (state.overlay === 'net' || state.overlay === 'listen' || state.overlay === 'hardware') return pageLines(state)
  if (state.overlay === 'history') return historyLines(state)
  if (state.overlay === 'report') return reportLines(state)
  if (state.overlay === 'log') return logLines(state)
  if (state.overlay === 'settings') return settingsLines(state)
  if (state.overlay === 'record') return recordLines(state)
  return []
}

function overlayTitle(overlay: ScreenState['overlay']): string {
  switch (overlay) {
    case 'help':
      return 'help'
    case 'kill':
      return 'kill'
    case 'detail':
      return 'process'
    case 'columns':
      return 'columns'
    case 'theme':
      return 'theme'
    case 'net':
      return 'connections'
    case 'listen':
      return 'listen'
    case 'hardware':
      return 'hardware'
    case 'history':
      return 'history'
    case 'report':
      return 'report'
    case 'log':
      return 'probe log'
    case 'settings':
      return 'settings'
    case 'record':
      return 'record'
    default:
      return 'sloppytop'
  }
}

function framed(title: string, body: string[], width: number): string[] {
  return [band(title, width), ...body, bandBottom(width)]
}

function footerText(state: ScreenState, system: Partial<SystemStats>, rows: DisplayRow[]): string {
  const left = [system.hostname, system.os_version, system.kernel_version]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .map((part) => plain(part))
    .join(' · ')
  const selected = rows.find((row) => row.kind === 'process' && row.proc.pid === state.selectedPid)
  let right: string
  if (state.processesOff) right = 'processes off'
  else if (selected?.kind === 'process') right = `PID ${selected.proc.pid}  ${plain(selected.proc.name)}`
  else {
    const count = system.process_count !== undefined ? system.process_count : rows.filter((row) => row.kind === 'process').length
    right = `${count} processes`
  }
  if (!left) return right
  const gap = state.width - widthOf(left) - widthOf(right)
  if (gap < 2) return `${left}  ${right}`
  return `${left}${' '.repeat(gap)}${right}`
}

function helpLines(): string[] {
  return [
    'sloppytop',
    '/ s f  search     space  pause     ?  help     q  quit',
    'up j  move        g G  ends        1-9 0  sort  T  tree',
    'p  pin   i  detail   k  kill   c  columns   t  theme   r  refresh',
    'e  env   o  files   n  connections   l  listen   h  hardware',
    'a  record   v  history   w  report   b  probe log   m  settings',
    'y  confirm a kill    n  cancel    hardware r  re-read',
  ]
}

const SETTINGS_WINDOW = 8

function historyLines(state: ScreenState): string[] {
  const page = state.historyPage
  if (!page || page.status === 'loading') return ['history …', 'esc  close']
  if (page.status !== 'ready') return ['history', ...wrapWords(page.message, state.width), 'esc  close']
  const width = chartWidth(state.width)
  const lines = ['history']
  if (page.cpu.length > 0) lines.push(`cpu  ${sparkline(page.cpu, { max: 100, width })}`)
  if (page.memory.length > 0) lines.push(`mem  ${sparkline(page.memory, { width })}`)
  if (page.load.length > 0) lines.push(`load ${sparkline(page.load, { width })}`)
  if (page.recent.length > 0) {
    lines.push('recent')
    for (const point of page.recent) {
      lines.push(`  ${point.at}  cpu ${point.cpu.toFixed(1)}  mem ${formatBytesCompact(point.memory)}  load ${point.load.toFixed(2)}`)
    }
  }
  lines.push('esc  close')
  return lines
}

function reportLines(state: ScreenState): string[] {
  const page = state.reportPage
  if (!page || page.status === 'loading') return ['report …', 'esc  close']
  if (page.status !== 'ready' || !page.summary) return ['report', ...wrapWords(page.message, state.width), 'esc  close']
  const summary = page.summary
  const width = chartWidth(state.width)
  const lines = [
    'report',
    `cpu ${summary.cpu_avg.toFixed(1)} avg  ${summary.cpu_peak.toFixed(1)} peak`,
    `mem ${formatBytesCompact(summary.memory_used_avg)} avg  ${formatBytesCompact(summary.memory_used_peak)} peak`,
    `load ${summary.load1_avg.toFixed(2)} avg  ${summary.load1_peak.toFixed(2)} peak`,
  ]
  if (page.cpu.length > 0) lines.push(`cpu  ${sparkline(page.cpu, { max: 100, width })}`)
  if (page.memory.length > 0) lines.push(`mem  ${sparkline(page.memory, { width })}`)
  if (page.load.length > 0) lines.push(`load ${sparkline(page.load, { width })}`)
  for (const hour of page.hourly.slice(-4)) {
    lines.push(`${hour.hour.slice(11, 16)}  n ${hour.samples}  cpu ${hour.cpu_avg.toFixed(1)}/${hour.cpu_peak.toFixed(1)}`)
  }
  if (page.top.length > 0) {
    lines.push('top')
    for (const row of page.top) lines.push(`  ${plain(row.name)}  ${row.cpu_avg.toFixed(1)}%  ${formatBytesCompact(row.memory_avg_bytes)}`)
  }
  if (page.anomalies.length > 0) {
    lines.push('anomalies')
    for (const row of page.anomalies) lines.push(`  ${row.at.slice(11, 19)}  ${row.type}`)
  }
  if (page.leaks.length > 0) {
    lines.push('rss leaks')
    for (const row of page.leaks) lines.push(`  ${plain(row.name)}  ${formatBytesCompact(row.total_growth_bytes)}`)
  }
  if (page.groups.length > 0) {
    lines.push('groups')
    for (const row of page.groups) lines.push(`  ${plain(row.name)}  ${row.score.toFixed(1)}`)
  }
  lines.push('esc  close')
  return lines
}

function logLines(state: ScreenState): string[] {
  const page = state.logPage
  if (!page || page.status === 'loading') return ['probe log …', 'esc  close']
  if (page.status === 'error') return ['probe log', page.message, 'esc  close']
  if (page.lines.length === 0) return ['probe log', 'no probe lines', 'esc  close']
  return ['probe log', ...page.lines.slice(-12), 'esc  close']
}

function settingsLines(state: ScreenState): string[] {
  const page = state.settingsPage
  if (!page) return ['settings', 'esc  close']
  const lines = ['settings', page.serviceLine, `metrics  ${page.host}:${page.port}  ${page.listening ? 'listening' : 'stopped'}`]
  if (page.metricsMessage) lines.push(page.metricsMessage)
  const start = Math.max(0, Math.min(state.panelIndex - 3, PROBE_NAMES.length - SETTINGS_WINDOW))
  for (const name of PROBE_NAMES.slice(start, start + SETTINGS_WINDOW)) {
    const mark = name === PROBE_NAMES[state.panelIndex] ? '>' : ' '
    const box = page.probes[name] ? '[x]' : '[ ]'
    lines.push(`${mark} ${box} ${name}`)
  }
  lines.push('space  toggle    m  listener    esc  close')
  lines.push('service install stays a command')
  return lines
}

function recordLines(state: ScreenState): string[] {
  return ['record', ...wrapWords(state.recordPage?.message ?? 'recording…', state.width), 'esc  close']
}

function wrapWords(text: string, width: number): string[] {
  const limit = Math.max(8, width)
  const lines: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    const next = current ? `${current} ${word}` : word
    if ([...next].length > limit && current) {
      lines.push(current)
      current = word
    } else current = next
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

function chartWidth(width: number): number {
  return Math.max(8, width - 6)
}

function processFactLines(proc: ProcessInfo): string[] {
  const lines = [
    `cpu     ${formatPercent(proc.cpu_usage)}`,
    `memory  ${formatBytes(proc.memory_bytes)}`,
    `read    ${formatBytesCompact(proc.disk_read_bytes)}/s`,
    `write   ${formatBytesCompact(proc.disk_write_bytes)}/s`,
    `user    ${plain(proc.user)}`,
    `status  ${plain(proc.status)}`,
    `time    ${formatRuntime(proc.runtime_secs)}`,
  ]
  if (proc.threads !== undefined) lines.push(`threads ${proc.threads}`)
  if (proc.virtual_memory_bytes !== undefined) lines.push(`virtual ${formatBytes(proc.virtual_memory_bytes)}`)
  if (proc.gpu_time_ms !== undefined) lines.push(`gpu     ${proc.gpu_time_ms.toFixed(1)} ms`)
  if (proc.phys_footprint_bytes !== undefined) lines.push(`foot    ${formatBytes(proc.phys_footprint_bytes)}`)
  if (proc.idle_wakeups_per_s !== undefined) lines.push(`wakeups ${proc.idle_wakeups_per_s.toFixed(1)}/s`)
  if (proc.owning_app) lines.push(`app     ${plain(proc.owning_app)}`)
  if (proc.cgroup) lines.push(`cgroup  ${plain(proc.cgroup)}`)
  return lines
}

function killLines(state: ScreenState, processes: ProcessInfo[]): string[] {
  const proc = processes.find((row) => row.pid === state.selectedPid)
  const name = proc ? plain(proc.name) : 'process'
  const pid = state.selectedPid ?? 0
  return [`kill ${pid} ${name}?`, 'y  confirm', 'n  cancel']
}

function detailLines(state: ScreenState, processes: ProcessInfo[]): string[] {
  const pid = state.detail?.pid ?? state.selectedPid
  const proc = processes.find((row) => row.pid === pid)
  if (!proc) return ['process left the list', 'esc  close']
  const detail = state.detail?.pid === proc.pid ? state.detail : null
  if (detail?.message && detail.cwd === undefined && detail.env === undefined && detail.files === undefined && !detail.filesOmitted) {
    return [`pid ${proc.pid}  ${plain(proc.name)}`, detail.message, 'esc  close']
  }
  const cwdLine = !detail?.loaded ? 'cwd …' : detail.cwd ? `cwd ${plain(detail.cwd)}` : 'cwd'
  const children = processes.filter((row) => row.ppid === proc.pid)
  const lines = [
    `pid ${proc.pid}  ${plain(proc.name)}  ppid ${proc.ppid}`,
    ...processFactLines(proc),
    cwdLine,
    'children',
    ...(children.length === 0 ? ['  none'] : children.slice(0, 12).map((child) => `  ${child.pid} ${plain(child.name)}`)),
  ]
  if (detail?.env) {
    lines.push('env')
    if (detail.env.length === 0) lines.push('  none')
    else {
      for (const item of detail.env.slice(0, 8)) lines.push(`  ${plain(item)}`)
      if (detail.env.length > 8) lines.push(`  +${detail.env.length - 8} more`)
    }
  }
  if (detail?.files || detail?.filesOmitted) {
    lines.push('files')
    if (detail.filesOmitted) lines.push('  unavailable')
    else if (!detail.files || detail.files.length === 0) lines.push('  none')
    else {
      for (const file of detail.files.slice(0, 8)) {
        const type = file.type ? `${plain(file.type)} ` : ''
        const protocol = file.protocol ? ` ${plain(file.protocol)}` : ''
        lines.push(`  ${plain(file.fd)} ${type}${plain(file.name)}${protocol}`)
      }
      if (detail.files.length > 8) lines.push(`  +${detail.files.length - 8} more`)
    }
  }
  lines.push('e  env    o  files    esc  close')
  return lines
}

const PAGE_CAP = 8

function pageLines(state: ScreenState): string[] {
  const page = state.page
  if (!page || page.kind !== state.overlay) return ['esc  close']
  if (page.status === 'loading') return [`${pageTitle(page.kind)} …`, 'esc  close']
  if (page.status === 'off' || page.status === 'error') return [page.message || pageTitle(page.kind), 'esc  close']
  if (page.kind === 'net') return netLines(page.net ?? [])
  if (page.kind === 'listen') return listenLines(page.listen ?? [])
  return hardwareLines(page.hardware)
}

function pageTitle(kind: 'net' | 'listen' | 'hardware'): string {
  if (kind === 'net') return 'connections'
  if (kind === 'listen') return 'listen'
  return 'hardware'
}

function netLines(rows: NetViewRow[]): string[] {
  if (rows.length === 0) return ['connections  0', 'no connections', 'esc  close']
  const shown: string[] = []
  for (const row of rows.slice(0, PAGE_CAP)) {
    const socket = row.state ? `  ${plain(row.state)}` : ''
    shown.push(`${plain(row.proto)}  ${plain(row.local)}  ${plain(row.remote)}${socket}`)
    shown.push(`  ${row.pid} ${plain(row.name)}  rx ${formatBytesCompact(row.rx_bytes_per_s)}/s  tx ${formatBytesCompact(row.tx_bytes_per_s)}/s`)
  }
  return [`connections  ${rows.length}`, ...shown, ...more(rows.length), 'esc  close']
}

function listenLines(rows: ListenViewRow[]): string[] {
  if (rows.length === 0) return ['listen  0', 'no listeners', 'esc  close']
  const shown = rows.slice(0, PAGE_CAP).map((row) => {
    const pid = row.pid === undefined ? '' : `${row.pid} `
    return `${plain(row.protocol)}  ${row.port}  ${pid}${plain(row.name ?? '')}`
  })
  return [`listen  ${rows.length}`, ...shown, ...more(rows.length), 'esc  close']
}

function hardwareLines(report: HardwareView | undefined): string[] {
  if (!report) return ['hardware', 'esc  close']
  const lines = [`hardware  ${report.from_cache ? 'cached' : 'fresh'}`]
  if (report.chip) lines.push(`chip  ${plain(report.chip)}`)
  if (report.model) lines.push(`model  ${plain(report.model)}`)
  const cores = [
    report.logical_cores === undefined ? '' : `${report.logical_cores} logical`,
    report.performance_cores === undefined ? '' : `${report.performance_cores}P`,
    report.efficiency_cores === undefined ? '' : `${report.efficiency_cores}E`,
    report.gpu_cores === undefined ? '' : `${report.gpu_cores} GPU`,
  ].filter((part) => part !== '')
  if (cores.length > 0) lines.push(`cores  ${cores.join('  ')}`)
  if (report.memory_bytes !== undefined) lines.push(`memory  ${formatBytes(report.memory_bytes)}`)
  for (const display of report.displays.slice(0, 6)) {
    const resolution = display.resolution ? `  ${plain(display.resolution)}` : ''
    const main = display.main ? '  main' : ''
    lines.push(`display  ${plain(display.name)}${resolution}${main}`)
  }
  if (report.displays.length > 6) lines.push(`+${report.displays.length - 6} more`)
  if (report.battery) {
    const health = report.battery.health ? plain(report.battery.health) : 'battery'
    const capacity = report.battery.maximum_capacity_percent
    const cycles = report.battery.cycle_count
    const extra = [
      capacity === undefined ? '' : `${capacity}%`,
      cycles === undefined ? '' : `${cycles} cycles`,
    ].filter((part) => part !== '')
    lines.push(`battery  ${health}${extra.length ? `  ${extra.join('  ')}` : ''}`)
  }
  if (report.cpu_features && report.cpu_features.length > 0) {
    lines.push(`flags  ${report.cpu_features.map((flag) => plain(flag)).join(' ')}`)
  }
  lines.push('r  re-read    esc  close')
  return lines
}

function more(count: number): string[] {
  return count > PAGE_CAP ? [`+${count - PAGE_CAP} more`] : []
}

function columnLines(state: ScreenState): string[] {
  const lines = ['columns', ...TUI_COLUMNS.map((id, index) => {
    const on = state.columns.includes(id) ? 'x' : ' '
    const cursor = index === state.panelIndex ? '>' : ' '
    return `${cursor} [${on}] ${id}`
  })]
  lines.push('space  toggle    esc  close')
  return lines
}

function themeLines(state: ScreenState): string[] {
  const lines = ['theme', ...THEME_NAMES.map((name, index) => {
    const cursor = index === state.panelIndex ? '>' : ' '
    return `${cursor} ${getTheme(name).label}`
  })]
  lines.push('enter  use    esc  cancel')
  return lines
}

function toolbarText(state: ScreenState, rows: DisplayRow[], total: number, error: string): string {
  const shown = rows.filter((row) => row.kind === 'process').length
  const mode = state.paused ? 'FROZEN' : 'live'
  const query = state.searching ? `/${state.draft}` : state.search ? `/${state.search}` : ''
  const notice = state.statusMessage || error
  const search = query || '/ search'
  const full = [
    notice,
    `${shown}/${total}`,
    mode,
    search,
    `${state.refreshMs}ms`,
    'p pin',
    'k kill',
    'i process',
    'n connections',
    'l listen',
    'h hardware',
    '? help',
    'q quit',
  ]
    .filter((part) => part !== '')
    .join('   ')
  if (widthOf(full) <= state.width) return full
  const short = [notice, `${shown}/${total}`, mode, query, 'q quit'].filter((part) => part !== '').join('  ')
  if (widthOf(short) <= state.width) return short
  return 'q quit'
}
