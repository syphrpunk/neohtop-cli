import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { defaultProbes, projectProcesses, projectSystem } from '../monitor/probes.ts'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { DEFAULT_TUI } from '../store/config.ts'
import { applyPointer, compose, emptyHistory, pushHistory } from './frame.ts'
import { initialState, reduce, visibleRows, wantsQuit, type KeyPress, type ScreenState } from './state.ts'

function key(name: string, extra: Partial<KeyPress> = {}): KeyPress {
  return { name, ctrl: false, shift: false, ...extra }
}

function proc(partial: Partial<ProcessInfo> & Pick<ProcessInfo, 'pid' | 'name'>): ProcessInfo {
  return {
    ppid: 0,
    cpu_usage: 0,
    memory_bytes: 0,
    status: 'Sleeping',
    user: 'me',
    command: partial.name,
    runtime_secs: 1,
    disk_read_bytes: 0,
    disk_write_bytes: 0,
    ...partial,
  }
}

function measured(partial: Partial<SystemStats> = {}): SystemStats {
  return {
    cpu_brand: 'test',
    cpu_usage_per_core: [],
    cpu_usage_total: 0,
    core_count: 0,
    memory_total: 0,
    memory_used: 0,
    memory_free: 0,
    uptime_secs: 0,
    load_avg: [0, 0, 0],
    network_rx_bytes: 0,
    network_tx_bytes: 0,
    disk_total_bytes: 0,
    disk_used_bytes: 0,
    disk_free_bytes: 0,
    hostname: 'box',
    os_version: 'testos',
    kernel_version: '0',
    process_count: 0,
    ...partial,
  }
}

function inner(line: string): string {
  let text = line.trim()
  if (text.startsWith('│')) text = text.slice(1).trim()
  if (text.endsWith('│')) text = text.slice(0, -1).trim()
  return text
}

function lineStarting(text: string, prefix: string): string | undefined {
  const lines = text.split('\n').map(inner)
  return (
    lines.find((line) => line.startsWith(`${prefix} `) || line.startsWith(`${prefix}  `)) ??
    lines.find((line) => line.includes(`  ${prefix} `) || line.includes(`  ${prefix}  `))
  )
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

describe('stats strip', () => {
  test('omitted cpu adds no history point, and a measured 0 does', () => {
    expect(pushHistory(emptyHistory(), {}).cpu).toEqual([])
    expect(pushHistory(emptyHistory(), { cpu_usage_total: 0 }).cpu).toEqual([0])

    const blank = compose(screen(), { processes: [], system: {}, history: emptyHistory() })
    const cpuBlank = lineStarting(blank.text, 'CPU')
    const diskBlank = lineStarting(blank.text, 'DSK')
    expect(cpuBlank).toContain('—')
    expect(cpuBlank).not.toContain('0.0%')
    expect(diskBlank).toContain('—')
    expect(diskBlank).not.toContain('0.0')
    expect(pushHistory(emptyHistory(), { cpu_usage_per_core: [1, 2] }).cores).toEqual([[1], [2]])
    expect(pushHistory(emptyHistory(), {}).cores).toEqual([])
    expect(pushHistory(emptyHistory(), { cpu_usage_per_core: [] }).cores).toEqual([])

    const history = pushHistory(emptyHistory(), {
      cpu_usage_total: 0,
      memory_used: 0,
      memory_total: 1024,
      disk_used_bytes: 0,
      disk_total_bytes: 2048,
      network_rx_bytes: 0,
      network_tx_bytes: 0,
    })
    const drawn = compose(screen(), {
      processes: [],
      system: {
        cpu_usage_total: 0,
        memory_used: 0,
        memory_total: 1024,
        disk_used_bytes: 0,
        disk_total_bytes: 2048,
        network_rx_bytes: 0,
        network_tx_bytes: 0,
      },
      history,
    })
    expect(lineStarting(drawn.text, 'CPU')).toContain('0.0%')
    expect(lineStarting(drawn.text, 'MEM')).toContain('0.0 B')
    expect(lineStarting(drawn.text, 'DSK')).toContain('0.0 B')
    expect(lineStarting(drawn.text, 'rx')).toContain('0B/s')
    expect(lineStarting(drawn.text, 'tx')).toContain('0B/s')
    expect(drawn.text).toContain('Catppuccin Mocha')

    const wattsOnly = pushHistory(emptyHistory(), { cpu_power_watts: 3 })
    expect(wattsOnly.cpu).toEqual([])
    expect(wattsOnly.mem).toEqual([])
    expect(wattsOnly.disk).toEqual([])
  })

  test('a measured zero is drawn, and a missing temperature is not a row', () => {
    const present = compose(screen({ height: 48, width: 80 }), {
      processes: [],
      system: {
        cpu_power_watts: 1,
        gpu_power_watts: 2,
        ane_power_watts: 0,
        dram_power_watts: 4,
        temperatures: [{ name: 'ambient', celsius: 0 }],
        fans: [{ name: 'fan1', rpm: 0 }],
        thermal_state: 'nominal',
        swap_total_bytes: 0,
        swap_used_bytes: 0,
        battery_charge_percent: 0,
        battery_charging: false,
        memory_wired_bytes: 0,
        pageins_per_s: 0,
        gpu_utilization_percent: 0,
        gpu_memory_bytes: 0,
        disk_devices: [
          {
            name: 'disk0',
            read_bytes_per_s: 0,
            write_bytes_per_s: 0,
            read_iops: 0,
            write_iops: 0,
          },
        ],
      },
      history: emptyHistory(),
    })
    const presentLines = present.text.split('\n').map(inner)
    expect(presentLines.some((line) => line.includes('ambient') && line.includes('0°C'))).toBe(true)
    expect(presentLines.some((line) => line.includes('fan1') && line.includes('0 rpm'))).toBe(true)
    expect(presentLines.some((line) => line.includes('cpu') && line.includes('1.00 W'))).toBe(true)
    expect(presentLines.some((line) => line.includes('gpu') && line.includes('2.00 W'))).toBe(true)
    expect(presentLines.some((line) => line.includes('ane') && line.includes('0 W'))).toBe(true)
    expect(presentLines.some((line) => line.includes('dram') && line.includes('4.00 W'))).toBe(true)
    expect(presentLines.some((line) => line.includes('1.00 W') && line.includes('4.00 W'))).toBe(false)
    expect(lineStarting(present.text, 'thermal')?.trim()).toBe('thermal  nominal')
    expect(lineStarting(present.text, 'swap')).toContain('0.0 B')
    expect(present.text).toContain('0%')
    expect(present.text).toContain('not charging')
    expect(presentLines.some((line) => line.startsWith('wired') && line.includes('0.0 B'))).toBe(true)
    expect(presentLines.some((line) => line.startsWith('in') && line.includes('0/s'))).toBe(true)
    expect(presentLines.some((line) => line.startsWith('gpu') && line.includes('0.0%'))).toBe(true)
    expect(present.text).toContain('disk0')
    expect(presentLines.some((line) => line.startsWith('read') && line.includes('0B/s'))).toBe(true)
    expect(present.text).not.toContain('7.00 W')

    const missing = compose(screen(), {
      processes: [],
      system: { thermal_state: 'nominal', fans: [{ name: 'fan1', rpm: 1200 }] },
      history: emptyHistory(),
    })
    expect(missing.text.split('\n').some((line) => line.startsWith('temp'))).toBe(false)
    expect(lineStarting(missing.text, 'thermal')?.trim()).toBe('thermal  nominal')
    expect(missing.text).toContain('fan1')
    expect(missing.text).toContain('1200 rpm')
  })

  test('sensors off drops thermal state, temperatures, and fans', () => {
    const hidden = projectSystem(
      measured({
        thermal_state: 'serious',
        temperatures: [{ name: 'die', celsius: 61 }],
        fans: [{ name: 'exhaust', rpm: 900 }],
      }),
      { ...defaultProbes(), sensors: false },
    )
    const frame = compose(screen(), { processes: [], system: hidden, history: emptyHistory() })
    expect(frame.text).not.toContain('serious')
    expect(frame.text).not.toContain('die')
    expect(frame.text).not.toContain('exhaust')
    expect(frame.text.split('\n').some((line) => line.startsWith('temp'))).toBe(false)
    expect(frame.text.split('\n').some((line) => line.startsWith('thermal'))).toBe(false)
  })

  test('core labels appear only when the kind list matches the core array', () => {
    const labeled = compose(screen(), {
      processes: [],
      system: {
        cpu_usage_per_core: [10, 4],
        cpu_core_kinds: ['performance', 'efficiency'],
      },
      history: emptyHistory(),
    })
    expect(lineStarting(labeled.text, 'cores')).toContain('10P 4E')

    const mismatched = compose(screen(), {
      processes: [],
      system: {
        cpu_usage_per_core: [10, 4],
        cpu_core_kinds: ['performance'],
      },
      history: emptyHistory(),
    })
    const cores = lineStarting(mismatched.text, 'cores')
    expect(cores).toContain('10 4')
    expect(cores).not.toContain('P')
    expect(cores).not.toContain('E')
  })

  test('optional readings sit above the process header', () => {
    const processes = [proc({ pid: 1, name: 'one' })]
    const bare = compose(screen(), { processes, system: {}, history: emptyHistory() })
    const rich = compose(screen(), {
      processes,
      system: { thermal_state: 'fair', memory_pressure_level: 'warning' },
      history: emptyHistory(),
    })
    expect(rich.layout.headerLine).toBeGreaterThan(bare.layout.headerLine)
    expect(rich.layout.bodyRows).toBeLessThan(bare.layout.bodyRows)
    expect(rich.text.split('\n')[rich.layout.headerLine]).toContain('PID')
    expect(lineStarting(rich.text, 'pressure')?.trim()).toBe('pressure  warning')
    expect(lineStarting(rich.text, 'pressure')).not.toContain('%')
  })

  test('a short terminal still shows the process under a labeled system band', () => {
    const frame = compose(screen({ height: 24, width: 80, selectedPid: 7 }), {
      processes: [proc({ pid: 7, name: 'kept' })],
      system: {
        hostname: 'box',
        cpu_power_watts: 1,
        gpu_power_watts: 2,
        ane_power_watts: 0,
        dram_power_watts: 4,
        thermal_state: 'nominal',
        temperatures: [{ name: 'ambient', celsius: 0 }],
        fans: [{ name: 'fan1', rpm: 0 }],
      },
      history: emptyHistory(),
    })
    expect(frame.text).toContain('╭─ system')
    expect(frame.text).toContain('kept')
    expect(frame.text).toContain('1.00 W')
    expect(frame.text).toContain('4.00 W')
    expect(frame.text).not.toContain('7.00 W')
    expect(frame.text).toContain('thermal  nominal')
    expect(frame.text.split('\n')[frame.layout.headerLine]).toContain('PID')
    const rule = frame.text.split('\n')[frame.layout.headerLine + 1] ?? ''
    expect(rule.trim().startsWith('─')).toBe(true)
    expect(frame.text).toContain('box')
    expect(frame.text).toContain('PID 7  kept')
  })

  test('a wide terminal draws titled panels and per-core readings', () => {
    const system: Partial<SystemStats> = {
      cpu_usage_total: 10,
      cpu_usage_per_core: [10, 4],
      cpu_core_kinds: ['performance', 'efficiency'],
      memory_used: 1024,
      memory_total: 2048,
    }
    const history = pushHistory(emptyHistory(), system)
    const frame = compose(screen({ width: 120, height: 40, selectedPid: 1 }), {
      processes: [proc({ pid: 1, name: 'kept' })],
      system: { ...system },
      history,
    })
    expect(frame.text).toContain('╭─ cpu')
    expect(frame.text).toContain('╭─ mem')
    expect(frame.text).toContain('╭─ disk')
    expect(frame.text).toContain('╭─ net')
    expect(frame.text).toContain('10P')
    expect(frame.text).toContain('4E')
    expect(frame.text).toContain('kept')
    expect(frame.text).toMatch(/[⣀⣤⣶⣿]/)
    expect(frame.text.split('\n')[frame.layout.headerLine]).toContain('PID')
  })

  test('each probe is its own labeled rows, not one packed line', () => {
    const system: Partial<SystemStats> = {
      cpu_usage_total: 10,
      cpu_usage_per_core: [10, 4],
      cpu_core_kinds: ['performance', 'efficiency'],
      memory_used: 1024,
      memory_total: 4096,
      memory_wired_bytes: 512,
      memory_free: 2048,
      pageins_per_s: 0,
      disk_used_bytes: 1024,
      disk_total_bytes: 4096,
      disk_free_bytes: 2048,
      disk_devices: [
        {
          name: 'disk0',
          read_bytes_per_s: 0,
          write_bytes_per_s: 2048,
          read_iops: 0,
          write_iops: 3,
          read_latency_ms: 1.5,
        },
      ],
      network_rx_bytes: 0,
      network_tx_bytes: 4096,
      cpu_power_watts: 1,
      gpu_power_watts: 2,
      ane_power_watts: 0,
      dram_power_watts: 4,
      gpu_utilization_percent: 0,
      gpu_renderer_utilization_percent: 1,
      gpu_memory_bytes: 0,
      thermal_state: 'nominal',
      temperatures: [{ name: 'ambient', celsius: 0 }],
      fans: [{ name: 'fan1', rpm: 0 }],
      memory_pressure_level: 'normal',
      psi_cpu_some_avg10: 0,
      battery_charge_percent: 0,
      battery_charging: false,
      swap_used_bytes: 0,
      swap_total_bytes: 1024,
      hostname: 'studio',
      os_version: 'macOS 15',
      kernel_version: '24.6.0',
      load_avg: [1, 0.5, 0.25],
      uptime_secs: 90,
      process_count: 4,
      cpu_brand: 'Test Chip',
    }
    const frame = compose(screen({ width: 140, height: 56, selectedPid: 1 }), {
      processes: [proc({ pid: 1, name: 'kept' })],
      system,
      history: pushHistory(emptyHistory(), system),
    })
    for (const title of ['cpu', 'mem', 'disk', 'net', 'power', 'gpu', 'sensors', 'pressure', 'battery', 'swap', 'host']) {
      expect(frame.text).toContain(`╭─ ${title}`)
    }
    const lines = frame.text.split('\n').map(inner)
    const raw = frame.text.split('\n')
    expect(raw.some((line) => line.includes('rx') && line.includes('0B/s') && !line.includes('tx'))).toBe(true)
    expect(raw.some((line) => line.includes('tx') && line.includes('4.0K/s') && !line.includes('rx'))).toBe(true)
    expect(raw.some((line) => line.includes('read') && line.includes('0B/s'))).toBe(true)
    expect(raw.some((line) => line.includes('write') && line.includes('2.0K/s'))).toBe(true)
    expect(lines.some((line) => line.includes('1.00 W') && line.includes('4.00 W'))).toBe(false)
    expect(frame.text).toMatch(/wired\s+512\.0 B/)
    expect(frame.text).toContain('not charging')
    expect(frame.text).toContain('Test Chip')
    expect(frame.text).toContain('kept')
    expect(frame.text).not.toContain('7.00 W')
    expect(frame.layout.headerLine).toBeGreaterThan(0)
  })

  test('a wide probe box keeps one reading on each row', () => {
    const frame = compose(screen({ width: 160, height: 70, selectedPid: 1 }), {
      processes: [proc({ pid: 1, name: 'kept' })],
      system: {
        cpu_usage_total: 10,
        memory_used: 1024,
        memory_total: 4096,
        disk_used_bytes: 1024,
        disk_total_bytes: 4096,
        network_rx_bytes: 0,
        network_tx_bytes: 4096,
        cpu_power_watts: 1,
        gpu_power_watts: 2,
        ane_power_watts: 0,
        dram_power_watts: 4,
        hostname: 'studio',
        load_avg: [1, 0.5, 0.25],
        uptime_secs: 90,
      },
      history: emptyHistory(),
    })
    const lines = frame.text.split('\n')
    expect(frame.text).toContain('╭─ power')
    expect(frame.text).toContain('╭─ host')
    expect(lines.some((line) => line.includes('1.00 W') && line.includes('2.00 W'))).toBe(false)
    expect(lines.some((line) => line.includes('ane') && line.includes('4.00 W'))).toBe(false)
    expect(lines.some((line) => line.includes('1.00 0.50 0.25') && line.includes('1m 30s'))).toBe(false)
    expect(lines.some((line) => line.includes('1.00 W'))).toBe(true)
    expect(lines.some((line) => line.includes('4.00 W'))).toBe(true)
    expect(lines.some((line) => line.includes('1.00 0.50 0.25'))).toBe(true)
    expect(lines.some((line) => line.includes('1m 30s'))).toBe(true)
    expect(frame.text).toContain('kept')
  })
})

describe('process table', () => {
  test('an empty list says no processes', () => {
    const frame = compose(screen(), { processes: [], system: {}, history: emptyHistory() })
    expect(frame.text).toContain('no processes')
  })

  test('the processes probe off replaces the rows with the reason', () => {
    const frame = compose(screen({ processesOff: true }), {
      processes: [proc({ pid: 1, name: 'hidden' })],
      system: {},
      history: emptyHistory(),
    })
    expect(frame.text).toContain('processes probe is off')
    expect(frame.text).not.toContain('hidden')
  })

  test('the selected row starts with >', () => {
    const frame = compose(screen({ selectedPid: 42 }), {
      processes: [proc({ pid: 42, name: 'nginx', command: 'nginx' })],
      system: {},
      history: emptyHistory(),
    })
    const line = frame.text.split('\n').find((row) => row.includes('nginx'))
    expect(line?.startsWith('>')).toBe(true)
  })

  test('a header click sorts by that column, and the same column flips', () => {
    const state = screen({ sortBy: 'pid', sortOrder: 'asc' })
    const input = {
      processes: [proc({ pid: 1, name: 'one', cpu_usage: 1 }), proc({ pid: 2, name: 'two', cpu_usage: 9 })],
      system: {},
      history: emptyHistory(),
    }
    const frame = compose(state, input)
    const cpu = frame.layout.columns.find((column) => column.id === 'cpu')
    expect(cpu).toBeDefined()
    const first = applyPointer(state, frame.layout, frame.rows, {
      x: cpu!.x,
      y: frame.layout.headerLine,
      kind: 'down',
    })
    expect(first.state.sortBy).toBe('cpu')
    expect(first.state.sortOrder).toBe('desc')
    const second = applyPointer(first.state, frame.layout, frame.rows, {
      x: cpu!.x,
      y: frame.layout.headerLine,
      kind: 'down',
    })
    expect(second.state.sortBy).toBe('cpu')
    expect(second.state.sortOrder).toBe('asc')
  })

  test('a tree child name cell contains the branch mark', () => {
    const frame = compose(screen({ tree: true }), {
      processes: [proc({ pid: 1, ppid: 0, name: 'parent' }), proc({ pid: 2, ppid: 1, name: 'child' })],
      system: {},
      history: emptyHistory(),
    })
    expect(frame.text).toContain('└─ ')
    expect(frame.text).toContain('└─ child')
  })

  test('kill asks before it signals, and cancel does not', () => {
    const processes = [proc({ pid: 42, name: 'nginx', command: 'nginx: master' })]
    const state = screen({ selectedPid: 42, columns: ['pid', 'name'] })
    const rows = visibleRows(state, processes).rows
    const opened = reduce(state, key('k'), rows)
    expect(opened.state.overlay).toBe('kill')
    expect(opened.effect).toBeUndefined()
    expect(wantsQuit(opened.state, key('q'))).toBe(false)

    const confirmed = reduce(opened.state, key('y'), rows)
    expect(confirmed.effect?.kill?.pid).toBe(42)

    const cancelled = reduce(opened.state, key('n'), rows)
    expect(cancelled.state.overlay).toBe('none')
    expect(cancelled.effect).toBeUndefined()

    const overlay = compose(opened.state, { processes, system: {}, history: emptyHistory() })
    expect(overlay.text).toContain('kill 42 nginx?')
    expect(overlay.text).toContain('y  confirm')
    expect(overlay.text).toContain('n  cancel')
    expect(overlay.text).not.toContain('nginx: master')
  })

  test('an optional column shows a measured zero and stays blank when that probe is off', () => {
    const zero = compose(screen({ columns: ['pid', 'name', 'gpu', 'footprint', 'wakeups'] }), {
      processes: [proc({ pid: 3, name: 'app', gpu_time_ms: 0, phys_footprint_bytes: 0, idle_wakeups_per_s: 0 })],
      system: {},
      history: emptyHistory(),
    })
    const zeroLine = zero.text.split('\n').find((line) => line.includes('app'))
    expect(zeroLine).toContain('0.0')
    expect(zeroLine).toContain('0B')

    const stripped = projectProcesses([proc({ pid: 3, name: 'app', gpu_time_ms: 5 })], {
      ...defaultProbes(),
      gpu: false,
    })
    const blank = compose(screen({ columns: ['pid', 'name', 'gpu'] }), {
      processes: stripped,
      system: {},
      history: emptyHistory(),
    })
    const blankLine = blank.text.split('\n').find((line) => line.includes('app'))
    expect(blankLine).not.toContain('5.0')

    const picker = compose(screen({ overlay: 'columns' }), {
      processes: [],
      system: {},
      history: emptyHistory(),
    })
    expect(picker.text).toContain('virtual')
    expect(picker.text).toContain('owning_app')
    expect(picker.text).toContain('cgroup')
  })

  test('a narrow width still shows the pid and the name', () => {
    const frame = compose(screen({ width: 24, selectedPid: 42 }), {
      processes: [proc({ pid: 42, name: 'nginx', command: 'nginx: master process' })],
      system: {},
      history: emptyHistory(),
    })
    expect(frame.text).toContain('42')
    expect(frame.text).toContain('nginx')
    expect(frame.text).not.toContain('nginx: master process')
  })

  test('space pauses, p pins the process name, and q is typed during search', () => {
    const processes = [proc({ pid: 7, name: 'app', command: 'app --flag' })]
    const state = screen({ selectedPid: 7 })
    const rows = visibleRows(state, processes).rows
    const paused = reduce(state, key('space'), rows)
    expect(paused.state.paused).toBe(true)
    expect(compose(paused.state, { processes, system: {}, history: emptyHistory() }).text).toContain('FROZEN')

    const detail = reduce(state, key('i'), rows)
    expect(detail.effect?.detailPid).toBe(7)
    expect(detail.effect?.loadEnv).toBeUndefined()
    expect(detail.effect?.loadFiles).toBeUndefined()
    const detailFrame = compose(detail.state, { processes, system: {}, history: emptyHistory() })
    expect(detailFrame.text).toContain('cwd …')
    expect(detailFrame.text).toContain('children')
    expect(detailFrame.text).not.toContain('app --flag')

    const pinned = reduce(state, key('p'), rows)
    expect(pinned.effect?.pins).toEqual(['app'])
    expect(pinned.effect?.pins?.join(' ')).not.toContain('--flag')

    const searching = reduce(state, key('/'), rows)
    expect(searching.state.searching).toBe(true)
    const typed = reduce(searching.state, key('q'), rows)
    expect(typed.state.draft).toBe('q')
    expect(wantsQuit(typed.state, key('q'))).toBe(false)
  })

  test('columns, theme, and refresh stay in the screen state until they are closed', () => {
    const rows = visibleRows(screen(), []).rows
    const columns = reduce(screen({ columns: ['pid', 'name'] }), key('c'), rows)
    expect(columns.state.overlay).toBe('columns')
    const toggled = reduce(columns.state, key('space'), rows)
    expect(toggled.state.columns).toEqual(['name'])
    const saved = reduce(toggled.state, key('escape'), rows)
    expect(saved.state.overlay).toBe('none')
    expect(saved.effect?.tui?.columns).toEqual(['name'])

    const themes = reduce(screen({ theme: 'charm' }), key('t'), rows)
    const moved = reduce(themes.state, key('j'), rows)
    expect(moved.state.theme).toBe('mocha')
    const cancelled = reduce(moved.state, key('escape'), rows)
    expect(cancelled.state.theme).toBe('charm')
    expect(cancelled.effect).toBeUndefined()

    const refresh = reduce(screen({ refreshMs: 1000 }), key('r'), rows)
    expect(refresh.state.refreshMs).toBe(2000)
    expect(refresh.effect?.tui?.refreshMs).toBe(2000)
    expect(reduce(screen(), key('T'), rows).state.tree).toBe(true)
  })
})

describe('on-demand pages', () => {
  test('e and o request env and files, and q on a page does not quit', () => {
    const processes = [proc({ pid: 7, name: 'app' })]
    const state = screen({ selectedPid: 7 })
    const rows = visibleRows(state, processes).rows
    const env = reduce(state, key('e'), rows)
    expect(env.state.overlay).toBe('detail')
    expect(env.effect?.loadEnv).toBe(7)
    expect(env.effect?.loadFiles).toBeUndefined()

    const files = reduce(state, key('o'), rows)
    expect(files.effect?.loadFiles).toBe(7)
    expect(files.effect?.loadEnv).toBeUndefined()

    const net = reduce(state, key('n'), rows)
    expect(net.state.overlay).toBe('net')
    expect(net.state.page?.status).toBe('loading')
    expect(net.effect?.openNet).toBe(true)
    expect(wantsQuit(net.state, key('q'))).toBe(false)
    expect(reduce(net.state, key('escape'), rows).state.overlay).toBe('none')

    const hardware = reduce(state, key('h'), rows)
    const refresh = reduce(hardware.state, key('r'), rows)
    expect(refresh.effect?.refreshHardware).toBe(true)
    expect(refresh.state.overlay).toBe('hardware')
  })

  test('the detail page shows env and files only after they are loaded', () => {
    const processes = [proc({ pid: 7, ppid: 1, name: 'app' }), proc({ pid: 8, ppid: 7, name: 'child' })]
    const closed = compose(screen({ selectedPid: 7, overlay: 'detail', detail: { pid: 7, loaded: true, cwd: '/tmp/work' } }), {
      processes,
      system: {},
      history: emptyHistory(),
    })
    expect(closed.text).toContain('cwd /tmp/work')
    expect(closed.text).toContain('0.0%')
    expect(closed.text).toContain('read')
    expect(closed.text).toContain('write')
    expect(closed.text.split('\n').some((line) => line.trim() === 'env')).toBe(false)
    expect(closed.text.split('\n').some((line) => line.trim() === 'files')).toBe(false)

    const open = compose(
      screen({
        selectedPid: 7,
        overlay: 'detail',
        detail: {
          pid: 7,
          loaded: true,
          cwd: '/tmp/work',
          env: ['MODE=1'],
          files: [{ fd: '1', type: 'CHR', name: '/dev/null' }],
        },
      }),
      { processes, system: {}, history: emptyHistory() },
    )
    expect(open.text).toContain('MODE=1')
    expect(open.text).toContain('/dev/null')

    const omitted = compose(
      screen({
        selectedPid: 7,
        overlay: 'detail',
        detail: { pid: 7, loaded: true, cwd: '/tmp/work', filesOmitted: true },
      }),
      { processes, system: {}, history: emptyHistory() },
    )
    expect(omitted.text).toContain('unavailable')
  })

  test('connections render on the page, and a measured zero rate stays zero', () => {
    const frame = compose(
      screen({
        overlay: 'net',
        page: {
          kind: 'net',
          status: 'ready',
          message: '',
          net: [
            {
              proto: 'tcp',
              local: '127.0.0.1:80',
              remote: '10.0.0.2:9',
              pid: 4,
              name: 'nginx',
              rx_bytes_per_s: 0,
              tx_bytes_per_s: 0,
            },
          ],
        },
      }),
      { processes: [], system: {}, history: emptyHistory() },
    )
    expect(frame.text).toContain('127.0.0.1:80')
    expect(frame.text).toContain('0B/s')

    const off = compose(
      screen({
        overlay: 'listen',
        page: { kind: 'listen', status: 'off', message: 'probe listen is off — sloppytop probe enable listen' },
      }),
      { processes: [], system: {}, history: emptyHistory() },
    )
    expect(off.text).toContain('probe listen is off')
  })
})

describe('screen boundaries', () => {
  test('the table does not sample, and only the runner signals a confirmed kill', () => {
    const frame = readFileSync(new URL('./frame.ts', import.meta.url), 'utf8')
    const state = readFileSync(new URL('./state.ts', import.meta.url), 'utf8')
    const run = readFileSync(new URL('./run.ts', import.meta.url), 'utf8')
    const pages = readFileSync(new URL('./pages.ts', import.meta.url), 'utf8')
    for (const src of [frame, state]) {
      expect(src.includes('takeSample')).toBe(false)
      expect(src.includes('openFiles')).toBe(false)
      expect(src.includes('hardwareInventory')).toBe(false)
      expect(src.includes('listeningSockets')).toBe(false)
      expect(src.includes('sampleNet')).toBe(false)
      expect(src.includes('process.kill')).toBe(false)
    }
    const tick = run.slice(run.indexOf('const tick = async'), run.indexOf('await new Promise'))
    expect(tick.includes('takeSample')).toBe(true)
    expect(tick.includes('fulfillPage')).toBe(false)
    expect(tick.includes('openFiles')).toBe(false)
    expect(tick.includes('hardwareInventory')).toBe(false)
    expect(tick.includes('listeningSockets')).toBe(false)
    expect(tick.includes('sampleNet')).toBe(false)
    expect(tick.includes('queryHistory')).toBe(false)
    expect(tick.includes('insertSample')).toBe(false)
    expect(tick.includes('openDb')).toBe(false)
    expect(tick.includes('Bun.serve')).toBe(false)
    expect(tick.includes('loadHistory')).toBe(false)
    expect(tick.includes('recordWithStore')).toBe(false)
    expect(tick.includes('bindMetricsListener')).toBe(false)
    for (const src of [frame, state]) {
      expect(src.includes('queryHistory')).toBe(false)
      expect(src.includes('insertSample')).toBe(false)
      expect(src.includes('openDb')).toBe(false)
      expect(src.includes('Bun.serve')).toBe(false)
    }
    expect(run.includes('process.kill')).toBe(true)
    expect(pages.includes('processDetail')).toBe(true)
    expect(pages.includes('openFiles')).toBe(true)
    expect(pages.includes('hardwareInventory')).toBe(true)
    expect(pages.includes('listeningSockets')).toBe(true)
    expect(pages.includes('sampleNet')).toBe(true)
  })
})
