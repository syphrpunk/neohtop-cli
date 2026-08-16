// launchd user-agent management for the hourly metrics recorder —
// the TS analog of the npm installer's "setup" step. macOS only for
// now (platform priority: macOS → Linux systemd timer later).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { logPath } from './config.ts'

export const LABEL = 'com.syphrpunk.neohtop.record'

export const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)

function xmlEscape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Command line launchd should run. launchd's PATH is minimal, so every
 * path must be absolute. Compiled binaries embed their entry as
 * /$bunfs/... — then execPath alone IS the CLI; in dev, run
 * `<abs bun> <abs script> record`.
 */
export function recordCommand(): string[] {
  const entry = process.argv[1] ?? ''
  const compiled = entry.startsWith('/$bunfs')
  return compiled
    ? [process.execPath, 'record']
    : [process.execPath, resolve(entry), 'record']
}

export function renderPlist(args: string[], intervalSecs: number): string {
  const argXml = args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>StartInterval</key>
  <integer>${intervalSecs}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath())}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath())}</string>
</dict>
</plist>
`
}

function launchctl(args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync('launchctl', args, { encoding: 'utf8', stdio: 'pipe' })
    return { ok: true, output }
  } catch (err) {
    return { ok: false, output: (err as { stderr?: string }).stderr ?? String(err) }
  }
}

const domain = () => `gui/${process.getuid?.() ?? 501}`

export function install(intervalSecs: number): { plist: string; command: string[] } {
  if (process.platform !== 'darwin')
    throw new Error('service install is macOS-only for now (Linux systemd timer planned)')
  const command = recordCommand()
  const path = plistPath()
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
  writeFileSync(path, renderPlist(command, intervalSecs))
  launchctl(['bootout', `${domain()}/${LABEL}`]) // ignore failure — may not be loaded
  const boot = launchctl(['bootstrap', domain(), path])
  if (!boot.ok) throw new Error(`launchctl bootstrap failed: ${boot.output}`)
  return { plist: path, command }
}

export function uninstall(): { removed: boolean } {
  launchctl(['bootout', `${domain()}/${LABEL}`])
  const path = plistPath()
  const existed = existsSync(path)
  rmSync(path, { force: true })
  return { removed: existed }
}

export function status(): { installed: boolean; loaded: boolean; plist: string } {
  const path = plistPath()
  const print = launchctl(['print', `${domain()}/${LABEL}`])
  return { installed: existsSync(path), loaded: print.ok, plist: path }
}
