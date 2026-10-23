import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { defaultProbes } from '../monitor/probes.ts'
import type { SystemStats } from '../monitor/types.ts'
import { DEFAULT_TUI } from '../store/config.ts'
import { compose, emptyHistory } from './frame.ts'
import { EMPTY_WINDOW, attemptRecord, bindMetricsListener, historyView, logView, readService, reportView } from './store.ts'
import { initialState, reduce, wantsQuit, type KeyPress, type ScreenState } from './state.ts'

function key(name: string, extra: Partial<KeyPress> = {}): KeyPress {
  return { name, ctrl: false, shift: false, ...extra }
}

function screen(over: Partial<ScreenState> = {}): ScreenState {
  return {
    ...initialState(
      { columns: [...DEFAULT_TUI.columns], theme: 'mocha', refreshMs: 1000, pins: [] },
      { width: 80, height: 24 },
    ),
    waiting: false,
    ...over,
  }
}

function mtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

describe('record gate', () => {
  test('cpu off refuses before the sample and the insert', async () => {
    const probes = defaultProbes()
    probes.cpu = false
    let sampled = false
    let inserted = false
    const result = await attemptRecord(probes, {
      sample: async () => {
        sampled = true
        return { system: { cpu_usage_total: 1 } as SystemStats, processes: [] }
      },
      insert: () => {
        inserted = true
        return { sampleId: 4, processesStored: 1 }
      },
    })
    expect(result.recorded).toBe(false)
    expect(result.message).toBe('PROBE_DISABLED  record needs these probes enabled: cpu')
    expect(sampled).toBe(false)
    expect(inserted).toBe(false)

    const frame = compose(screen({ overlay: 'record', recordPage: { message: result.message } }), {
      processes: [],
      system: {},
      history: emptyHistory(),
    })
    expect(frame.text).toContain('PROBE_DISABLED')
    expect(frame.text).toContain('record needs these probes enabled: cpu')
  })

  test('a clear gate records the sample id', async () => {
    let sampled = false
    const result = await attemptRecord(defaultProbes(), {
      sample: async () => {
        sampled = true
        return { system: { cpu_usage_total: 1 } as SystemStats, processes: [] }
      },
      insert: () => ({ sampleId: 4, processesStored: 2 }),
    })
    expect(sampled).toBe(true)
    expect(result.recorded).toBe(true)
    expect(result.message).toContain('recorded sample 4')
    expect(result.message).toContain('2 processes')
  })
})

describe('history and report pages', () => {
  test('an empty store draws the empty window and no sparkline', () => {
    const view = historyView([])
    expect(view.status).toBe('empty')
    expect(view.message).toBe(EMPTY_WINDOW)
    expect(view.cpu).toEqual([])
    expect(view.memory).toEqual([])
    expect(view.load).toEqual([])
    const frame = compose(screen({ overlay: 'history', historyPage: view }), {
      processes: [],
      system: {},
      history: emptyHistory(),
    })
    expect(frame.text.split('\n').map((line) => line.trim()).join(' ')).toContain(EMPTY_WINDOW)
    expect(frame.text.split('\n').some((line) => line.startsWith('cpu'))).toBe(false)
    expect(frame.text.split('\n').some((line) => line.startsWith('CPU'))).toBe(false)
  })

  test('charts run oldest first and the recent list stays newest first', () => {
    const view = historyView([
      { at: '2026-10-23T00:00:02.000Z', cpu_usage_total: 2, memory_used: 20, load_1: 0.2 },
      { at: '2026-10-23T00:00:01.000Z', cpu_usage_total: 1, memory_used: 10, load_1: 0.1 },
    ])
    expect(view.cpu).toEqual([1, 2])
    expect(view.memory).toEqual([10, 20])
    expect(view.load).toEqual([0.1, 0.2])
    expect(view.recent[0]).toEqual({ at: '00:00:02', cpu: 2, memory: 20, load: 0.2 })
  })

  test('an empty report uses the same empty window', () => {
    const view = reportView(null)
    expect(view.status).toBe('empty')
    expect(view.message).toBe(EMPTY_WINDOW)
    expect(view.cpu).toEqual([])
    expect(view.summary).toBeNull()
  })

  test('the summary is the sample-weighted average and peak', () => {
    const view = reportView({
      hourly: [
        {
          hour: '2026-10-23T01:00Z',
          samples: 1,
          cpu_avg: 10,
          cpu_peak: 10,
          memory_used_avg: 100,
          memory_used_peak: 100,
          load1_avg: 1,
          load1_peak: 1,
        },
        {
          hour: '2026-10-23T02:00Z',
          samples: 3,
          cpu_avg: 20,
          cpu_peak: 40,
          memory_used_avg: 200,
          memory_used_peak: 500,
          load1_avg: 2,
          load1_peak: 4,
        },
      ],
      top: [],
      anomalies: [],
      leaks: [],
      groups: [],
    })
    expect(view.summary).toEqual({
      cpu_avg: 17.5,
      cpu_peak: 40,
      memory_used_avg: 175,
      memory_used_peak: 500,
      load1_avg: 1.8,
      load1_peak: 4,
      anomaly_count: 0,
    })
    expect(view.cpu).toEqual([10, 20])
  })
})

describe('probe log and settings', () => {
  test('a probe line drops cwd and keeps hostname and array length', () => {
    const view = logView([
      {
        probe: 'proc',
        pid: 9,
        cwd: '/tmp/sloppytop-secret-cwd',
        environ: ['SLOPPY_SECRET=hunter2'],
        command: 'secret-command',
        local: '203.0.113.10:9999',
        remote: '203.0.113.11:1',
        children: [1, 2],
        hostname: 'box',
      },
    ])
    const line = view.lines.join('\n')
    expect(line).not.toContain('/tmp/sloppytop-secret-cwd')
    expect(line).not.toContain('cwd')
    expect(line).not.toContain('hunter2')
    expect(line).not.toContain('secret-command')
    expect(line).not.toContain('203.0.113.10')
    expect(line).toContain('hostname box')
    expect(line).toContain('children 2')
  })

  test('settings shows a stopped listener and leaves install as a command', () => {
    const service = readService(() => ({ scheduler: 'launchd', installed: false, loaded: false, files: [] }))
    expect(service.line).toBe('service  launchd  not installed  not loaded')
    expect(readService(() => {
      throw new Error('service status is not supported on win32')
    }).line).toBe('service status is not supported on win32')

    const frame = compose(
      screen({
        overlay: 'settings',
        panelIndex: 0,
        settingsPage: {
          probes: defaultProbes(),
          metricsEnabled: false,
          host: '127.0.0.1',
          port: 9464,
          listening: false,
          metricsMessage: '',
          serviceLine: service.line,
        },
      }),
      { processes: [], system: {}, history: emptyHistory() },
    )
    expect(frame.text).toContain('not installed')
    expect(frame.text).toContain('127.0.0.1:9464  stopped')
    expect(frame.text).toContain('> [x] cpu')
    expect(frame.text).toContain('service install stays a command')
  })

  test('store keys open pages, and q on a page does not quit', () => {
    const help = compose(screen({ overlay: 'help' }), { processes: [], system: {}, history: emptyHistory() })
    expect(help.text).toContain('a  record')
    expect(help.text).toContain('v  history')
    expect(help.text).toContain('m  settings')

    const recorded = reduce(screen(), key('a'), [])
    expect(recorded.state.overlay).toBe('record')
    expect(recorded.state.recordPage?.message).toBe('recording…')
    expect(recorded.effect?.record).toBe(true)
    expect(wantsQuit(recorded.state, key('q'))).toBe(false)
    expect(reduce(recorded.state, key('q'), []).state.overlay).toBe('none')

    const history = reduce(screen(), key('v'), [])
    expect(history.state.overlay).toBe('history')
    expect(history.state.historyPage?.status).toBe('loading')
    expect(history.effect?.openHistory).toBe(true)

    const settings = reduce(screen(), key('m'), [])
    expect(settings.effect?.openSettings).toBe(true)
    const toggled = reduce(settings.state, key('space'), [])
    expect(toggled.state.paused).toBe(false)
    expect(toggled.state.settingsPage?.probes.cpu).toBe(false)
    expect(toggled.effect?.toggleProbe).toEqual({ name: 'cpu', enabled: false })
    const listener = reduce(settings.state, key('m'), [])
    expect(listener.effect?.toggleMetrics).toBe(true)
    expect(listener.state.settingsPage?.metricsMessage).toBe('starting…')
    expect(listener.state.paused).toBe(false)
  })
})

describe('metrics listener', () => {
  test('a thrown bind is a message', () => {
    const bound = bindMetricsListener(
      { host: '127.0.0.1', port: 9, sample: async () => ({}) },
      () => {
        throw new Error('address in use')
      },
    )
    expect(bound.ok).toBe(false)
    if (!bound.ok) expect(bound.message).toContain('address in use')
  })

  test('a temp config serves OpenMetrics and leaves the real config untouched', async () => {
    const real = [
      join(homedir(), '.config', 'sloppytop', 'config.json'),
      join(homedir(), '.config', 'neohtop', 'config.json'),
    ]
    const before = real.map(mtime)
    const temp = mkdtempSync(join(tmpdir(), 'sloppytop-metrics-'))
    const script = fileURLToPath(new URL('./metrics-listen-check.ts', import.meta.url))
    const cwd = fileURLToPath(new URL('../..', import.meta.url))
    const child = spawn(process.execPath, [script], {
      cwd,
      env: { ...process.env, XDG_CONFIG_HOME: temp },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (status) => resolve(status ?? 1))
    })
    try {
      if (code !== 0) throw new Error(`metrics check ${code}\n${stderr}\n${stdout}`)
      const payload = JSON.parse(stdout.trim()) as { config: string; status: number; type: string; body: string; other: number }
      expect(payload.config.startsWith(temp)).toBe(true)
      expect(payload.status).toBe(200)
      expect(payload.type).toBe('application/openmetrics-text; version=1.0.0; charset=utf-8')
      expect(payload.body).toContain('# EOF')
      expect(payload.body).toContain('sloppytop_cpu_usage_percent')
      expect(payload.other).toBe(404)
      expect(real.map(mtime)).toEqual(before)
    } finally {
      if (child.exitCode === null) child.kill()
      rmSync(temp, { recursive: true, force: true })
    }
  }, 15_000)
})
