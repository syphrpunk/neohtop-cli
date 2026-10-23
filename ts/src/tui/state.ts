// Screen rules shared by the live view and the tests.
// A kill is an effect. This module does not signal the process.

import { FilterQueryError, filterProcesses, sortProcesses, type SortKey } from '../filter/index.ts'
import { splitPinned } from '../filter/pins.ts'
import { buildProcessTree } from '../filter/tree.ts'
import { defaultProbes, PROBE_NAMES, type ProbeName, type ProbeSet } from '../monitor/probes.ts'
import type { ProcessInfo } from '../monitor/types.ts'
import { TUI_COLUMNS, type TuiColumn } from '../store/config.ts'
import { THEME_NAMES } from './theme.ts'

export type Overlay =
  | 'none'
  | 'help'
  | 'kill'
  | 'detail'
  | 'columns'
  | 'theme'
  | 'net'
  | 'listen'
  | 'hardware'
  | 'history'
  | 'report'
  | 'log'
  | 'settings'
  | 'record'

export interface FileRow {
  fd: string
  type?: string
  name: string
  protocol?: string
}

export interface NetViewRow {
  proto: string
  local: string
  remote: string
  state?: string
  pid: number
  name: string
  rx_bytes_per_s: number
  tx_bytes_per_s: number
}

export interface ListenViewRow {
  protocol: string
  port: number
  pid?: number
  name?: string
}

export interface HardwareView {
  collected_at: string
  chip?: string
  model?: string
  model_id?: string
  logical_cores?: number
  performance_cores?: number
  efficiency_cores?: number
  gpu_cores?: number
  memory_bytes?: number
  displays: { name: string; resolution?: string; main?: boolean }[]
  battery?: { health?: string; maximum_capacity_percent?: number; cycle_count?: number }
  cpu_features?: string[]
  from_cache?: boolean
}

export interface DetailState {
  pid: number
  loaded: boolean
  cwd?: string
  env?: string[]
  files?: FileRow[]
  filesOmitted?: boolean
  message?: string
}

export type PageKind = 'net' | 'listen' | 'hardware'

export interface PageState {
  kind: PageKind
  status: 'loading' | 'ready' | 'off' | 'error'
  message: string
  net?: NetViewRow[]
  listen?: ListenViewRow[]
  hardware?: HardwareView
}

export interface HistoryPoint {
  at: string
  cpu: number
  memory: number
  load: number
}

export interface HistoryView {
  status: 'loading' | 'empty' | 'ready' | 'error'
  message: string
  cpu: number[]
  memory: number[]
  load: number[]
  recent: HistoryPoint[]
}

export interface ReportSummary {
  cpu_avg: number
  cpu_peak: number
  memory_used_avg: number
  memory_used_peak: number
  load1_avg: number
  load1_peak: number
  anomaly_count: number
}

export interface ReportHourLine {
  hour: string
  samples: number
  cpu_avg: number
  cpu_peak: number
  memory_used_avg: number
  memory_used_peak: number
  load1_avg: number
  load1_peak: number
}

export interface ReportTopLine {
  name: string
  cpu_avg: number
  memory_avg_bytes: number
}

export interface ReportAnomalyLine {
  at: string
  type: string
  detail: string
}

export interface ReportLeakLine {
  name: string
  metric: 'rss'
  total_growth_bytes: number
}

export interface ReportGroupLine {
  name: string
  score: number
}

export interface ReportView {
  status: 'loading' | 'empty' | 'ready' | 'error'
  message: string
  summary: ReportSummary | null
  cpu: number[]
  memory: number[]
  load: number[]
  hourly: ReportHourLine[]
  top: ReportTopLine[]
  anomalies: ReportAnomalyLine[]
  leaks: ReportLeakLine[]
  groups: ReportGroupLine[]
}

export interface LogView {
  status: 'loading' | 'ready' | 'error'
  message: string
  lines: string[]
}

export interface SettingsView {
  probes: ProbeSet
  metricsEnabled: boolean
  host: string
  port: number
  listening: boolean
  metricsMessage: string
  serviceLine: string
}

export interface ScreenState {
  width: number
  height: number
  paused: boolean
  search: string
  draft: string
  searching: boolean
  sortBy: SortKey
  sortOrder: 'asc' | 'desc'
  tree: boolean
  selectedPid: number | null
  scroll: number
  overlay: Overlay
  panelIndex: number
  columns: TuiColumn[]
  theme: string
  refreshMs: number
  pins: string[]
  processesOff: boolean
  waiting: boolean
  detail: DetailState | null
  page: PageState | null
  statusMessage: string
  /** Table rows that fit under the current strip. Null until the first paint. */
  bodyRows: number | null
  /** Theme to restore when the theme list is cancelled. */
  savedTheme: string
  probes: ProbeSet
  metricsListening: boolean
  metricsEnabled: boolean
  metricsHost: string
  metricsPort: number
  historyPage: HistoryView | null
  reportPage: ReportView | null
  logPage: LogView | null
  settingsPage: SettingsView | null
  recordPage: { message: string } | null
}

export interface ScreenEffect {
  kill?: { pid: number }
  pins?: string[]
  tui?: { columns?: TuiColumn[]; theme?: string; refreshMs?: number }
  detailPid?: number
  loadEnv?: number
  loadFiles?: number
  openNet?: boolean
  openListen?: boolean
  openHardware?: boolean
  refreshHardware?: boolean
  openHistory?: boolean
  openReport?: boolean
  openLog?: boolean
  openSettings?: boolean
  toggleProbe?: { name: ProbeName; enabled: boolean }
  toggleMetrics?: boolean
  record?: boolean
}

export interface ReduceResult {
  state: ScreenState
  effect?: ScreenEffect
}

export type DisplayRow =
  | { kind: 'process'; proc: ProcessInfo; pinned: boolean; prefix: string }
  | { kind: 'missing'; pin: string }

export interface KeyPress {
  name: string
  ctrl: boolean
  shift: boolean
}

const REFRESH_MS = [1000, 2000, 3000, 5000, 500] as const

const SORT_BY_NUMBER: Record<string, SortKey> = {
  '1': 'pid',
  '2': 'name',
  '3': 'cpu',
  '4': 'memory',
  '5': 'status',
  '6': 'user',
  '7': 'command',
  '8': 'runtime',
  '9': 'disk',
  '0': 'threads',
}

/** Title, four meters, header, and the hint line, before any optional reading rows. */
const BODY_CHROME = 7

export function initialState(
  config: { columns: TuiColumn[]; theme: string; refreshMs: number; pins: string[] },
  size: { width: number; height: number } = { width: 80, height: 24 },
): ScreenState {
  return {
    width: size.width,
    height: size.height,
    paused: false,
    search: '',
    draft: '',
    searching: false,
    sortBy: 'cpu',
    sortOrder: 'desc',
    tree: false,
    selectedPid: null,
    scroll: 0,
    overlay: 'none',
    panelIndex: 0,
    columns: [...config.columns],
    theme: config.theme,
    refreshMs: config.refreshMs,
    pins: [...config.pins],
    processesOff: false,
    waiting: true,
    detail: null,
    page: null,
    statusMessage: '',
    savedTheme: config.theme,
    bodyRows: null,
    probes: defaultProbes(),
    metricsListening: false,
    metricsEnabled: false,
    metricsHost: '127.0.0.1',
    metricsPort: 9464,
    historyPage: null,
    reportPage: null,
    logPage: null,
    settingsPage: null,
    recordPage: null,
  }
}

export function visibleRows(
  state: ScreenState,
  processes: ProcessInfo[],
): { rows: DisplayRow[]; error: string } {
  if (state.processesOff) return { rows: [], error: '' }
  let filtered: ProcessInfo[]
  try {
    filtered = filterProcesses(processes, state.search)
  } catch (err) {
    const message = err instanceof FilterQueryError ? err.message : 'invalid filter'
    return { rows: [], error: message }
  }

  if (state.tree) {
    const split = splitPinned(filtered, state.pins)
    const tree = buildProcessTree(split.rest)
    return {
      rows: [
        ...split.pinned.map((proc) => processRow(proc, true, '')),
        ...missingRows(split.missing, state.search),
        ...tree.map((proc) => processRow(proc, false, proc.tree_prefix)),
      ],
      error: '',
    }
  }

  const sorted = sortProcesses(filtered, state.sortBy, state.sortOrder)
  const split = splitPinned(sorted, state.pins)
  return {
    rows: [
      ...split.pinned.map((proc) => processRow(proc, true, '')),
      ...missingRows(split.missing, state.search),
      ...split.rest.map((proc) => processRow(proc, false, '')),
    ],
    error: '',
  }
}

export function ensureSelection(state: ScreenState, rows: DisplayRow[]): ScreenState {
  const indexes = processIndexes(rows)
  if (indexes.length === 0) {
    return state.selectedPid === null ? state : { ...state, selectedPid: null }
  }
  const stillThere = indexes.some((index) => {
    const row = rows[index]
    return row?.kind === 'process' && row.proc.pid === state.selectedPid
  })
  if (stillThere) return state
  const first = rows[indexes[0]!]
  if (first?.kind !== 'process') return state
  return reveal(state, rows, first.proc.pid)
}

export function wantsQuit(state: ScreenState, key: KeyPress): boolean {
  if (key.ctrl && key.name === 'c') return true
  if (state.searching || state.overlay !== 'none') return false
  return key.name === 'q' || key.name === 'escape' || key.name === 'esc'
}

export function reduce(state: ScreenState, key: KeyPress, rows: DisplayRow[]): ReduceResult {
  if (key.ctrl && key.name === 'c') return { state }
  if (state.searching) return reduceSearch(state, key)
  if (state.overlay !== 'none') return reduceOverlay(state, key)
  return reduceMain(state, key, rows)
}

function reduceSearch(state: ScreenState, key: KeyPress): ReduceResult {
  if (key.name === 'escape' || key.name === 'esc') {
    return { state: { ...state, searching: false, draft: state.search } }
  }
  if (key.name === 'return' || key.name === 'enter') {
    return { state: { ...state, searching: false, search: state.draft, scroll: 0 } }
  }
  if (key.name === 'backspace' || key.name === 'delete') {
    return { state: { ...state, draft: [...state.draft].slice(0, -1).join('') } }
  }
  if (key.name === 'space') return { state: { ...state, draft: `${state.draft} ` } }
  if (key.name.length === 1) return { state: { ...state, draft: state.draft + key.name } }
  return { state }
}

function reduceOverlay(state: ScreenState, key: KeyPress): ReduceResult {
  if (state.overlay === 'kill') return reduceKill(state, key)
  if (state.overlay === 'columns') return reduceColumns(state, key)
  if (state.overlay === 'theme') return reduceTheme(state, key)
  if (state.overlay === 'detail') return reduceDetail(state, key)
  if (state.overlay === 'hardware') return reduceHardware(state, key)
  if (state.overlay === 'settings') return reduceSettings(state, key)
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q' || key.name === 'return' || key.name === 'enter') {
    return { state: { ...state, overlay: 'none' } }
  }
  return { state }
}

function reduceDetail(state: ScreenState, key: KeyPress): ReduceResult {
  const pid = state.detail?.pid ?? state.selectedPid
  if (key.name === 'e' && pid) return { state, effect: { loadEnv: pid } }
  if (key.name === 'o' && pid) return { state, effect: { loadFiles: pid } }
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q' || key.name === 'return' || key.name === 'enter') {
    return { state: { ...state, overlay: 'none' } }
  }
  return { state }
}

function reduceHardware(state: ScreenState, key: KeyPress): ReduceResult {
  if (key.name === 'r') {
    const page = state.page?.kind === 'hardware' ? { ...state.page, status: 'loading' as const, message: '' } : state.page
    return { state: { ...state, page }, effect: { refreshHardware: true } }
  }
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q' || key.name === 'return' || key.name === 'enter') {
    return { state: { ...state, overlay: 'none' } }
  }
  return { state }
}

function reduceSettings(state: ScreenState, key: KeyPress): ReduceResult {
  const page = state.settingsPage
  if (key.name === 'up' || key.name === 'k') {
    return { state: { ...state, panelIndex: Math.max(0, state.panelIndex - 1) } }
  }
  if (key.name === 'down' || key.name === 'j') {
    return { state: { ...state, panelIndex: Math.min(PROBE_NAMES.length - 1, state.panelIndex + 1) } }
  }
  if (key.name === 'space' && page) {
    const name = PROBE_NAMES[state.panelIndex]
    if (!name) return { state }
    const enabled = !page.probes[name]
    const probes: ProbeSet = { ...page.probes, [name]: enabled }
    return {
      state: { ...state, probes, settingsPage: { ...page, probes } },
      effect: { toggleProbe: { name, enabled } },
    }
  }
  if (key.name === 'm' && page) {
    return {
      state: { ...state, settingsPage: { ...page, metricsMessage: state.metricsListening ? 'stopping…' : 'starting…' } },
      effect: { toggleMetrics: true },
    }
  }
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q' || key.name === 'return' || key.name === 'enter') {
    return { state: { ...state, overlay: 'none' } }
  }
  return { state }
}

function reduceKill(state: ScreenState, key: KeyPress): ReduceResult {
  if (key.name === 'y' || key.name === 'return' || key.name === 'enter') {
    if (state.selectedPid === null) return { state: { ...state, overlay: 'none' } }
    return {
      state: { ...state, overlay: 'none' },
      effect: { kill: { pid: state.selectedPid } },
    }
  }
  if (key.name === 'n' || key.name === 'escape' || key.name === 'esc' || key.name === 'q') {
    return { state: { ...state, overlay: 'none' } }
  }
  return { state }
}

function reduceColumns(state: ScreenState, key: KeyPress): ReduceResult {
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q' || key.name === 'return' || key.name === 'enter') {
    return closeColumns(state)
  }
  if (key.name === 'up' || key.name === 'k') {
    return { state: { ...state, panelIndex: Math.max(0, state.panelIndex - 1) } }
  }
  if (key.name === 'down' || key.name === 'j') {
    return { state: { ...state, panelIndex: Math.min(TUI_COLUMNS.length - 1, state.panelIndex + 1) } }
  }
  if (key.name === 'space') {
    const id = TUI_COLUMNS[state.panelIndex]
    if (!id) return { state }
    return { state: { ...state, columns: toggleColumn(state.columns, id) } }
  }
  return { state }
}

function reduceTheme(state: ScreenState, key: KeyPress): ReduceResult {
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q') {
    return { state: { ...state, overlay: 'none', theme: state.savedTheme } }
  }
  if (key.name === 'return' || key.name === 'enter' || key.name === 'space') {
    return {
      state: { ...state, overlay: 'none' },
      effect: { tui: { theme: state.theme, columns: state.columns, refreshMs: state.refreshMs } },
    }
  }
  if (key.name === 'up' || key.name === 'k') return moveTheme(state, -1)
  if (key.name === 'down' || key.name === 'j') return moveTheme(state, 1)
  return { state }
}

function reduceMain(state: ScreenState, key: KeyPress, rows: DisplayRow[]): ReduceResult {
  const sort = SORT_BY_NUMBER[key.name]
  if (sort) return { state: toggleSort(state, sort) }
  if (key.name === 'T' || (key.name === 't' && key.shift)) {
    return { state: { ...state, tree: !state.tree, scroll: 0 } }
  }
  if (key.name === 't') {
    const found = THEME_NAMES.findIndex((name) => name === state.theme)
    const index = found < 0 ? 0 : found
    return { state: { ...state, overlay: 'theme', panelIndex: index, savedTheme: state.theme } }
  }
  if (key.name === 'r') {
    const refreshMs = nextRefresh(state.refreshMs)
    return {
      state: { ...state, refreshMs },
      effect: { tui: { refreshMs } },
    }
  }
  if (key.name === 'p' || key.name === 'u') return togglePin(state, rows)
  if (key.name === 'k' || key.name === 'x' || key.name === 'delete' || key.name === 'del') {
    return openKill(state, rows)
  }
  if (key.name === 'i' || key.name === 'return' || key.name === 'enter') return openDetail(state, rows)
  if (key.name === 'e') return openProcPage(state, rows, 'env')
  if (key.name === 'o') return openProcPage(state, rows, 'files')
  if (key.name === 'n') return openPage(state, 'net')
  if (key.name === 'l') return openPage(state, 'listen')
  if (key.name === 'h') return openPage(state, 'hardware')
  if (key.name === 'v') return openHistory(state)
  if (key.name === 'w') return openReport(state)
  if (key.name === 'b') return openLog(state)
  if (key.name === 'a') return openRecord(state)
  if (key.name === 'm') return openSettings(state)
  if (key.name === 'c') return { state: { ...state, overlay: 'columns', panelIndex: 0 } }
  if (key.name === '?' ) return { state: { ...state, overlay: 'help' } }
  if (key.name === '/' || key.name === 's' || key.name === 'f') {
    return { state: { ...state, searching: true, draft: state.search } }
  }
  if (key.name === 'space') return { state: { ...state, paused: !state.paused } }
  if (key.name === 'up') return { state: move(state, rows, -1) }
  if (key.name === 'down' || key.name === 'j') return { state: move(state, rows, 1) }
  if (key.name === 'pageup' || key.name === 'pgup') return { state: move(state, rows, -bodyWindow(state)) }
  if (key.name === 'pagedown' || key.name === 'pgdown') return { state: move(state, rows, bodyWindow(state)) }
  if (key.name === 'home' || (key.name === 'g' && !key.shift)) return { state: moveEnd(state, rows, 'start') }
  if (key.name === 'end' || key.name === 'G' || (key.name === 'g' && key.shift)) {
    return { state: moveEnd(state, rows, 'end') }
  }
  return { state }
}

export function toggleSort(state: ScreenState, sortBy: SortKey): ScreenState {
  if (state.sortBy === sortBy) {
    return { ...state, sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' }
  }
  return { ...state, sortBy, sortOrder: 'desc', scroll: 0 }
}

function nextRefresh(current: number): number {
  const index = REFRESH_MS.indexOf(current as (typeof REFRESH_MS)[number])
  if (index < 0) return REFRESH_MS[0]
  return REFRESH_MS[(index + 1) % REFRESH_MS.length]!
}

function toggleColumn(columns: TuiColumn[], id: TuiColumn): TuiColumn[] {
  if (columns.includes(id)) {
    if (columns.length === 1) return columns
    return columns.filter((column) => column !== id)
  }
  const chosen = new Set<TuiColumn>([...columns, id])
  return TUI_COLUMNS.filter((column) => chosen.has(column))
}

function closeColumns(state: ScreenState): ReduceResult {
  return {
    state: { ...state, overlay: 'none' },
    effect: { tui: { columns: state.columns, theme: state.theme, refreshMs: state.refreshMs } },
  }
}

function moveTheme(state: ScreenState, delta: number): ReduceResult {
  const index = Math.min(THEME_NAMES.length - 1, Math.max(0, state.panelIndex + delta))
  const theme = THEME_NAMES[index] ?? state.theme
  return { state: { ...state, panelIndex: index, theme } }
}

function openKill(state: ScreenState, rows: DisplayRow[]): ReduceResult {
  const proc = selected(state, rows)
  if (!proc) return { state }
  return { state: { ...state, overlay: 'kill', selectedPid: proc.pid } }
}

function openDetail(state: ScreenState, rows: DisplayRow[]): ReduceResult {
  const proc = selected(state, rows)
  if (!proc) return { state }
  return {
    state: { ...state, overlay: 'detail', selectedPid: proc.pid, detail: { pid: proc.pid, loaded: false } },
    effect: { detailPid: proc.pid },
  }
}

function openProcPage(state: ScreenState, rows: DisplayRow[], kind: 'env' | 'files'): ReduceResult {
  const proc = selected(state, rows)
  if (!proc) return { state }
  const detail = state.detail?.pid === proc.pid ? state.detail : { pid: proc.pid, loaded: false }
  return {
    state: { ...state, overlay: 'detail', selectedPid: proc.pid, detail },
    effect: kind === 'env' ? { loadEnv: proc.pid } : { loadFiles: proc.pid },
  }
}

function openHistory(state: ScreenState): ReduceResult {
  return {
    state: {
      ...state,
      overlay: 'history',
      historyPage: { status: 'loading', message: 'loading…', cpu: [], memory: [], load: [], recent: [] },
    },
    effect: { openHistory: true },
  }
}

function openReport(state: ScreenState): ReduceResult {
  return {
    state: {
      ...state,
      overlay: 'report',
      reportPage: {
        status: 'loading',
        message: 'loading…',
        summary: null,
        cpu: [],
        memory: [],
        load: [],
        hourly: [],
        top: [],
        anomalies: [],
        leaks: [],
        groups: [],
      },
    },
    effect: { openReport: true },
  }
}

function openLog(state: ScreenState): ReduceResult {
  return {
    state: { ...state, overlay: 'log', logPage: { status: 'loading', message: 'loading…', lines: [] } },
    effect: { openLog: true },
  }
}

function openRecord(state: ScreenState): ReduceResult {
  return {
    state: { ...state, overlay: 'record', recordPage: { message: 'recording…' } },
    effect: { record: true },
  }
}

function openSettings(state: ScreenState): ReduceResult {
  return {
    state: {
      ...state,
      overlay: 'settings',
      panelIndex: 0,
      settingsPage: {
        probes: { ...state.probes },
        metricsEnabled: state.metricsEnabled,
        host: state.metricsHost,
        port: state.metricsPort,
        listening: state.metricsListening,
        metricsMessage: '',
        serviceLine: 'service …',
      },
    },
    effect: { openSettings: true },
  }
}

function openPage(state: ScreenState, kind: PageKind): ReduceResult {
  const effect: ScreenEffect =
    kind === 'net' ? { openNet: true } : kind === 'listen' ? { openListen: true } : { openHardware: true }
  return {
    state: { ...state, overlay: kind, page: { kind, status: 'loading', message: '' } },
    effect,
  }
}

function togglePin(state: ScreenState, rows: DisplayRow[]): ReduceResult {
  const proc = selected(state, rows)
  if (!proc) return { state }
  const name = proc.name
  const pins = state.pins.includes(name) ? state.pins.filter((pin) => pin !== name) : [...state.pins, name]
  return { state: { ...state, pins }, effect: { pins } }
}

function selected(state: ScreenState, rows: DisplayRow[]): ProcessInfo | null {
  for (const row of rows) {
    if (row.kind === 'process' && row.proc.pid === state.selectedPid) return row.proc
  }
  return null
}

function move(state: ScreenState, rows: DisplayRow[], delta: number): ScreenState {
  const indexes = processIndexes(rows)
  if (indexes.length === 0) return state
  let pos = indexes.findIndex((index) => {
    const row = rows[index]
    return row?.kind === 'process' && row.proc.pid === state.selectedPid
  })
  if (pos < 0) pos = delta < 0 ? indexes.length - 1 : 0
  else pos = Math.min(indexes.length - 1, Math.max(0, pos + delta))
  const row = rows[indexes[pos]!]
  if (row?.kind !== 'process') return state
  return reveal(state, rows, row.proc.pid)
}

function moveEnd(state: ScreenState, rows: DisplayRow[], edge: 'start' | 'end'): ScreenState {
  const indexes = processIndexes(rows)
  if (indexes.length === 0) return state
  const index = edge === 'start' ? indexes[0]! : indexes[indexes.length - 1]!
  const row = rows[index]
  if (row?.kind !== 'process') return state
  return reveal({ ...state, scroll: edge === 'start' ? 0 : state.scroll }, rows, row.proc.pid)
}

function reveal(state: ScreenState, rows: DisplayRow[], pid: number): ScreenState {
  const index = rows.findIndex((row) => row.kind === 'process' && row.proc.pid === pid)
  if (index < 0) return { ...state, selectedPid: pid }
  const window = bodyWindow(state)
  let scroll = state.scroll
  if (index < scroll) scroll = index
  if (index >= scroll + window) scroll = index - window + 1
  return { ...state, selectedPid: pid, scroll }
}

function bodyWindow(state: ScreenState): number {
  if (state.bodyRows !== null) return Math.max(1, state.bodyRows)
  return Math.max(1, state.height - BODY_CHROME)
}

function processIndexes(rows: DisplayRow[]): number[] {
  const indexes: number[] = []
  rows.forEach((row, index) => {
    if (row.kind === 'process') indexes.push(index)
  })
  return indexes
}

function processRow(proc: ProcessInfo, pinned: boolean, prefix: string): DisplayRow {
  return { kind: 'process', proc, pinned, prefix }
}

function missingRows(missing: string[], search: string): DisplayRow[] {
  if (search.trim()) return []
  return missing.map((pin) => ({ kind: 'missing', pin }))
}
