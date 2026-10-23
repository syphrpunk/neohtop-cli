// The screen. Only `sloppytop tui` imports this module, so other commands
// do not load the native renderer.

import { createCliRenderer, MouseButton, TextRenderable, type CliRenderer } from '@opentui/core'
import type { ProbeSet } from '../monitor/probes.ts'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { isProbeName, type ProbeName } from '../monitor/probes.ts'
import { takeSample } from '../sample.ts'
import { ensureTuiConfig, loadConfig, saveConfig, updateMetrics, updateProbes } from '../store/config.ts'
import { appendProbeLog } from '../store/probe-log.ts'
import { defaultPageLoaders, fulfillPage, hasPageEffect, type PageLoaders } from './pages.ts'
import {
  bindMetricsListener,
  hasStoreEffect,
  loadHistory,
  loadLog,
  loadReport,
  readService,
  recordWithStore,
} from './store.ts'
import {
  applyPointer,
  compose,
  emptyHistory,
  pushHistory,
  stripLineCount,
  type Layout,
  type SampleHistory,
} from './frame.ts'
import {
  ensureSelection,
  initialState,
  reduce,
  visibleRows,
  wantsQuit,
  type DisplayRow,
  type DetailState,
  type KeyPress,
  type ScreenEffect,
  type ScreenState,
} from './state.ts'
import { styleFrame } from './style.ts'
import { getTheme, type Theme } from './theme.ts'

export function mountFrame(renderer: CliRenderer, theme: Theme): void {
  renderer.root.add(
    new TextRenderable(renderer, {
      id: 'title',
      content: `sloppytop  ${theme.label}`,
      fg: theme.text,
    }),
  )
  renderer.root.add(
    new TextRenderable(renderer, {
      id: 'hint',
      content: 'q  quit',
      fg: theme.subtext0,
    }),
  )
}

export function quitKey(name: string, ctrl: boolean): boolean {
  return name === 'q' || name === 'escape' || (ctrl && name === 'c')
}

export function bindQuit(renderer: CliRenderer, onQuit: () => void): void {
  renderer.keyInput.on('keypress', (ev) => {
    if (quitKey(ev.name, ev.ctrl)) onQuit()
  })
}

export async function runTui(loaders: PageLoaders = defaultPageLoaders()): Promise<void> {
  const config = ensureTuiConfig()
  const sampleMs = config.record.sampleMs
  let probes: ProbeSet = config.probes
  let state = initialState(
    {
      columns: config.tui.columns,
      theme: config.tui.theme,
      refreshMs: config.tui.refreshMs,
      pins: config.pins,
    },
    { width: 80, height: 24 },
  )
  let processes: ProcessInfo[] = []
  let system: Partial<SystemStats> = {}
  let history: SampleHistory = emptyHistory()
  let rows: DisplayRow[] = []
  let layout: Layout = { headerLine: -1, columns: [], bodyStart: 0, bodyRows: 0 }
  state = {
    ...state,
    probes: config.probes,
    metricsEnabled: config.metrics.enabled,
    metricsHost: config.metrics.host,
    metricsPort: config.metrics.port,
  }
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pageToken = 0
  let storeToken = 0
  let metricsStop: (() => void) | null = null

  const theme = getTheme(state.theme)
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    backgroundColor: theme.base,
  })
  renderer.useMouse = true
  const text = new TextRenderable(renderer, {
    id: 'frame',
    content: '',
    fg: theme.text,
    position: 'absolute',
    left: 0,
    top: 0,
    width: 80,
    height: 24,
    wrapMode: 'none',
  })
  renderer.root.add(text)

  const paint = () => {
    const width = renderer.terminalWidth || state.width || 80
    const height = renderer.terminalHeight || state.height || 24
    const strip = stripLineCount(system, width, height)
    const chrome = state.overlay === 'none' ? 5 : 3
    state = { ...state, width, height, bodyRows: Math.max(0, height - strip - chrome) }
    state = ensureSelection(state, visibleRows(state, processes).rows)
    const frame = compose(state, { processes, system, history })
    rows = frame.rows
    layout = frame.layout
    if (state.overlay === 'none') state = { ...state, bodyRows: frame.layout.bodyRows }
    const themeNow = getTheme(state.theme)
    text.content = styleFrame(frame.text, themeNow)
    text.fg = themeNow.text
    text.width = width
    text.height = height
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    if (timer) clearTimeout(timer)
    if (metricsStop) {
      try {
        metricsStop()
      } catch {
        // The socket can already be closed.
      }
      metricsStop = null
    }
    renderer.stop()
    renderer.destroy()
  }

  const apply = (effect: ScreenEffect | undefined) => {
    if (!effect) return
    if (effect.kill && effect.kill.pid > 0) {
      try {
        process.kill(effect.kill.pid, 'SIGTERM')
      } catch {
        // The process can exit between the confirm and the signal.
      }
    }
    if (effect.pins || effect.tui) persist(effect)
    if (effect.toggleProbe) persistProbe(effect.toggleProbe)
    if (effect.toggleMetrics) void toggleListener()
    if (hasPageEffect(effect)) void fulfillAndApply(effect)
    if (hasStoreEffect(effect)) void fulfillStore(effect)
  }

  const persistProbe = (toggle: { name: ProbeName; enabled: boolean }) => {
    if (!isProbeName(toggle.name)) return
    try {
      const saved = updateProbes([toggle.name], toggle.enabled)
      probes = saved.probes
      state = {
        ...state,
        probes: saved.probes,
        settingsPage: state.settingsPage ? { ...state.settingsPage, probes: saved.probes } : state.settingsPage,
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'probe save failed'
      const probesNow = { ...state.probes, [toggle.name]: !toggle.enabled }
      state = {
        ...state,
        probes: probesNow,
        statusMessage: message,
        settingsPage: state.settingsPage
          ? { ...state.settingsPage, probes: { ...state.settingsPage.probes, [toggle.name]: !toggle.enabled } }
          : state.settingsPage,
      }
    }
  }

  const toggleListener = async () => {
    if (metricsStop) {
      const stopListener = metricsStop
      metricsStop = null
      try {
        stopListener()
      } catch {
        // The socket can already be closed.
      }
      let message = 'listener stopped'
      try {
        const saved = updateMetrics({ enabled: false })
        state = {
          ...state,
          metricsListening: false,
          metricsEnabled: saved.metrics.enabled,
          metricsHost: saved.metrics.host,
          metricsPort: saved.metrics.port,
        }
      } catch (err) {
        message = err instanceof Error && err.message ? err.message : 'metrics save failed'
        state = { ...state, metricsListening: false }
      }
      if (state.overlay === 'settings' && state.settingsPage) {
        state = {
          ...state,
          settingsPage: {
            ...state.settingsPage,
            listening: false,
            metricsEnabled: state.metricsEnabled,
            host: state.metricsHost,
            port: state.metricsPort,
            metricsMessage: message,
          },
        }
      }
      if (!stopped) paint()
      return
    }
    try {
      const saved = updateMetrics({ enabled: true })
      const bound = bindMetricsListener({
        host: saved.metrics.host,
        port: saved.metrics.port,
        sample: () => takeSample(sampleMs).then((sample) => sample.system),
      })
      if (!bound.ok) {
        state = {
          ...state,
          metricsListening: false,
          metricsEnabled: saved.metrics.enabled,
          metricsHost: saved.metrics.host,
          metricsPort: saved.metrics.port,
        }
        if (state.settingsPage) {
          state = {
            ...state,
            settingsPage: {
              ...state.settingsPage,
              listening: false,
              metricsEnabled: saved.metrics.enabled,
              host: saved.metrics.host,
              port: saved.metrics.port,
              metricsMessage: bound.message,
            },
          }
        }
        if (!stopped) paint()
        return
      }
      metricsStop = bound.stop
      state = {
        ...state,
        metricsListening: true,
        metricsEnabled: true,
        metricsHost: saved.metrics.host,
        metricsPort: bound.port,
      }
      if (state.overlay === 'settings' && state.settingsPage) {
        state = {
          ...state,
          settingsPage: {
            ...state.settingsPage,
            listening: true,
            metricsEnabled: true,
            host: saved.metrics.host,
            port: bound.port,
            metricsMessage: `listening ${saved.metrics.host}:${bound.port}`,
          },
        }
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'metrics bind failed'
      if (state.settingsPage) {
        state = { ...state, settingsPage: { ...state.settingsPage, listening: false, metricsMessage: message } }
      }
    }
    if (!stopped) paint()
  }

  const fulfillStore = async (effect: ScreenEffect) => {
    const token = ++storeToken
    await Promise.resolve()
    try {
      if (effect.record) {
        const result = await recordWithStore()
        if (stopped || token !== storeToken || state.overlay !== 'record') return
        state = { ...state, recordPage: { message: result.message } }
      } else if (effect.openHistory) {
        const view = loadHistory()
        if (stopped || token !== storeToken || state.overlay !== 'history') return
        state = { ...state, historyPage: view }
      } else if (effect.openReport) {
        const view = loadReport()
        if (stopped || token !== storeToken || state.overlay !== 'report') return
        state = { ...state, reportPage: view }
      } else if (effect.openLog) {
        const view = loadLog()
        if (stopped || token !== storeToken || state.overlay !== 'log') return
        state = { ...state, logPage: { status: 'ready', message: '', lines: view.lines } }
      } else if (effect.openSettings) {
        const service = readService()
        if (stopped || token !== storeToken || state.overlay !== 'settings' || !state.settingsPage) return
        state = { ...state, settingsPage: { ...state.settingsPage, serviceLine: service.line } }
      }
    } catch (err) {
      if (stopped || token !== storeToken) return
      const message = err instanceof Error && err.message ? err.message : 'store failed'
      if (effect.record && state.overlay === 'record') state = { ...state, recordPage: { message } }
      if (effect.openHistory && state.overlay === 'history') {
        state = { ...state, historyPage: { status: 'error', message, cpu: [], memory: [], load: [], recent: [] } }
      }
      if (effect.openReport && state.overlay === 'report' && state.reportPage) {
        state = { ...state, reportPage: { ...state.reportPage, status: 'error', message } }
      }
      if (effect.openLog && state.overlay === 'log') {
        state = { ...state, logPage: { status: 'error', message, lines: [] } }
      }
      if (effect.openSettings && state.overlay === 'settings' && state.settingsPage) {
        state = { ...state, settingsPage: { ...state.settingsPage, serviceLine: message } }
      }
    }
    if (!stopped) paint()
  }

  const fulfillAndApply = async (effect: ScreenEffect) => {
    const token = ++pageToken
    try {
      const patch = await fulfillPage(effect, { probes, sampleMs, processes }, loaders)
      if (stopped || token !== pageToken) return
      if (patch.detail && state.overlay === 'detail' && state.detail?.pid === patch.detail.pid) {
        state = { ...state, detail: mergeDetail(state.detail, patch.detail) }
      }
      if (patch.page && state.overlay === patch.page.kind) state = { ...state, page: patch.page }
      if (patch.log.length > 0) {
        try {
          appendProbeLog(patch.log)
        } catch {
          // A failed probe-log write leaves the page on screen.
        }
      }
      if (!stopped) paint()
    } catch {
      // The page stays on its loading line. The next key can retry.
    }
  }

  text.onMouseDown = (ev) => {
    if (stopped || ev.button !== MouseButton.LEFT) return
    const result = applyPointer(state, layout, rows, { x: ev.x, y: ev.y, kind: 'down' })
    state = result.state
    apply(result.effect)
    paint()
  }

  text.onMouseScroll = (ev) => {
    const direction = ev.scroll?.direction
    if (stopped || (direction !== 'up' && direction !== 'down')) return
    const result = applyPointer(state, layout, rows, { x: ev.x, y: ev.y, kind: 'scroll', scroll: direction })
    state = result.state
    paint()
  }

  renderer.on('resize', () => {
    if (!stopped) paint()
  })

  const tick = async () => {
    if (stopped) return
    const started = Date.now()
    if (!state.paused) {
      try {
        const sample = await takeSample(sampleMs)
        if (stopped) return
        system = sample.system
        processes = sample.processes
        probes = sample.probes
        history = pushHistory(history, system)
        state = {
          ...state,
          waiting: false,
          processesOff: !sample.probes.processes,
          probes: sample.probes,
          statusMessage: '',
        }
      } catch (err) {
        if (stopped) return
        const message = err instanceof Error && err.message ? err.message : 'sample failed'
        state = { ...state, waiting: false, statusMessage: message }
      }
    }
    if (stopped) return
    paint()
    const wait = Math.max(0, state.refreshMs - (Date.now() - started))
    timer = setTimeout(() => void tick(), wait)
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      stop()
      resolve()
    }
    renderer.keyInput.on('keypress', (ev) => {
      if (ev.eventType === 'release' || stopped) return
      const key: KeyPress = { name: ev.name, ctrl: ev.ctrl, shift: ev.shift }
      if (wantsQuit(state, key)) {
        finish()
        return
      }
      const result = reduce(state, key, rows)
      state = result.state
      apply(result.effect)
      if (!stopped) paint()
    })
    paint()
    renderer.start()
    void tick()
  })
}

function mergeDetail(prev: DetailState | null, next: DetailState): DetailState {
  if (!prev || prev.pid !== next.pid) return next
  return {
    ...prev,
    ...next,
    cwd: next.cwd ?? prev.cwd,
    env: next.env ?? prev.env,
    files: next.files ?? prev.files,
    filesOmitted: next.filesOmitted ?? prev.filesOmitted,
    message: next.message ?? prev.message,
    loaded: next.loaded || prev.loaded,
  }
}

function persist(effect: ScreenEffect): void {
  try {
    const config = loadConfig()
    if (effect.pins) config.pins = effect.pins
    if (effect.tui) config.tui = { ...config.tui, ...effect.tui }
    saveConfig(config)
  } catch {
    // A failed write leaves the screen on the values already in memory.
  }
}
