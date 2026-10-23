import { lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, test } from 'bun:test'

const root = new URL('../..', import.meta.url).pathname

function run(name: string, args: string[]) {
  const home = mkdtempSync(join(tmpdir(), 'sloppytop-st-'))
  try {
    return spawnSync(join(root, name), args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, XDG_CONFIG_HOME: home },
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

describe('repo shim', () => {
  test('sloppytop is st, and both run this checkout', () => {
    expect(lstatSync(join(root, 'sloppytop')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(root, 'sloppytop'))).toBe('st')
    const script = readFileSync(join(root, 'st'), 'utf8')
    expect(script).toContain('ts/src/index.ts')
    expect(script).not.toMatch(/exec[^\n]*sloppytop-cli/)

    const viaSt = run('st', ['--help'])
    const viaName = run('sloppytop', ['--help'])
    expect(viaSt.status).toBe(0)
    expect(viaName.status).toBe(0)
    expect(viaSt.stdout).toContain('tui')
    expect(viaName.stdout).toBe(viaSt.stdout)
  })
})
