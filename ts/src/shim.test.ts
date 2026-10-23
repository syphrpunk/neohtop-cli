import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const root = fileURLToPath(new URL('../..', import.meta.url))

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
    const script = readFileSync(join(root, 'st'), 'utf8')
    expect(script).toContain('ts/src/index.ts')
    expect(script).not.toMatch(/exec[^\n]*sloppytop-cli/)

    const link = join(root, 'sloppytop')
    // Windows CI often omits the symlink, or writes the target text instead.
    // The shell shim is not the Windows release binary, so it is not executed there.
    if (process.platform === 'win32') {
      if (!existsSync(link)) return
      if (lstatSync(link).isSymbolicLink()) {
        expect(readlinkSync(link)).toBe('st')
      } else {
        expect(readFileSync(link, 'utf8').trim()).toBe('st')
      }
      return
    }

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe('st')
    const viaSt = run('st', ['--help'])
    const viaName = run('sloppytop', ['--help'])
    expect(viaSt.status).toBe(0)
    expect(viaName.status).toBe(0)
    expect(viaSt.stdout).toContain('tui')
    expect(viaName.stdout).toBe(viaSt.stdout)
  })
})
