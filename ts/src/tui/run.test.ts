import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { TextRenderable } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'
import type { ProcessInfo } from '../monitor/types.ts'
import { compose, emptyHistory } from './frame.ts'
import { initialState } from './state.ts'
import { styleFrame } from './style.ts'
import { getTheme, THEME_NAMES } from './theme.ts'
import { bindQuit, mountFrame, quitKey } from './run.ts'

describe('theme', () => {
  test('fifteen palettes, and an unknown name is charm', () => {
    expect(THEME_NAMES).toHaveLength(15)
    expect(getTheme('mocha').label).toBe('Catppuccin Mocha')
    expect(getTheme('rosePine').base).toBe('#191724')
    expect(getTheme('nope').name).toBe('charm')
    expect(getTheme('charm').purple).toBe('#5A56E0')
  })
})

describe('screen frame', () => {
  test('paints the theme label, and q requests quit', async () => {
    await using setup = await createTestRenderer({ width: 80, height: 24 })
    const theme = getTheme('mocha')
    mountFrame(setup.renderer, theme)
    let quit = false
    bindQuit(setup.renderer, () => {
      quit = true
    })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain('Catppuccin Mocha')
    setup.mockInput.pressKey('q')
    expect(quit).toBe(true)
    expect(quitKey('escape', false)).toBe(true)
    expect(quitKey('c', true)).toBe(true)
    expect(quitKey('c', false)).toBe(false)
  })

  test('paints the stats strip and the process table', async () => {
    await using setup = await createTestRenderer({ width: 80, height: 24 })
    const row: ProcessInfo = {
      pid: 7,
      ppid: 1,
      name: 'app',
      cpu_usage: 1,
      memory_bytes: 1024,
      status: 'Running',
      user: 'me',
      command: 'app',
      runtime_secs: 2,
      disk_read_bytes: 0,
      disk_write_bytes: 0,
    }
    const state = {
      ...initialState(
        { columns: ['pid', 'name', 'cpu'], theme: 'mocha', refreshMs: 1000, pins: [] },
        { width: 80, height: 24 },
      ),
      waiting: false,
      selectedPid: 7,
    }
    const frame = compose(state, {
      processes: [row],
      system: { cpu_usage_total: 3 },
      history: emptyHistory(),
    })
    setup.renderer.root.add(
      new TextRenderable(setup.renderer, {
        id: 'frame',
        content: frame.text,
        fg: '#c0caf5',
        width: 80,
        height: 24,
        wrapMode: 'none',
      }),
    )
    await setup.renderOnce()
    const painted = setup.captureCharFrame()
    expect(painted).toContain('Catppuccin Mocha')
    expect(painted).toContain('CPU')
    expect(painted).toContain('PID')
    expect(painted).toContain('app')
  })

  test('color keeps the same characters and marks the cpu label', () => {
    const theme = getTheme('mocha')
    const source = 'CPU  95.0%\n>  7 app\n╭─ cpu ─╮\n1/1   FROZEN   / search   q quit'
    const styled = styleFrame(source, theme)
    expect(styled.chunks.map((chunk) => chunk.text).join('')).toBe(source)
    const cpu = styled.chunks.find((chunk) => chunk.text === 'CPU')
    const hot = styled.chunks.find((chunk) => chunk.text === '95.0%')
    const selected = styled.chunks.find((chunk) => chunk.text.startsWith('>'))
    expect(cpu?.fg).toBeTruthy()
    expect(hot?.fg).toBeTruthy()
    expect(selected?.bg).toBeTruthy()
    expect(String(hot?.fg)).not.toBe(String(cpu?.fg))
  })
})

describe('cli entry', () => {
  test('opentui is imported only from the screen command', () => {
    const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    expect(src.includes("from '@opentui/core'")).toBe(false)
    expect(src.includes("await import('./tui/run.ts')")).toBe(true)
  })
})
