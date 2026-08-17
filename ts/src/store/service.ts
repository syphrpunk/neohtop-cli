// Scheduled metrics recorder — launchd user agent on macOS, systemd user
// timer on Linux. Both run `neohtop record` on an interval with absolute
// paths (neither scheduler inherits a useful PATH).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { logPath } from './config.ts'

export const LABEL = 'com.syphrpunk.neohtop.record'
export const UNIT = 'neohtop-record'

export const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)

const systemdUserDir = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'systemd', 'user')
export const servicePath = () => join(systemdUserDir(), `${UNIT}.service`)
export const timerPath = () => join(systemdUserDir(), `${UNIT}.timer`)

/** Scheduler name + identifier for the current platform (for display). */
export function scheduler(): { kind: 'launchd' | 'systemd'; name: string } {
  return process.platform === 'darwin'
    ? { kind: 'launchd', name: LABEL }
    : { kind: 'systemd', name: `${UNIT}.timer` }
}

function xmlEscape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Command line the scheduler should run. Compiled binaries embed their entry
 * as /$bunfs/... — then execPath alone IS the CLI; in dev, run
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

/** systemd-style quoting: double-quote any arg with spaces/quotes/backslashes. */
function unitQuote(arg: string): string {
  if (!/[\s"'\\]/.test(arg)) return arg
  return `"${arg.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function renderServiceUnit(args: string[]): string {
  return `[Unit]
Description=neohtop metrics recorder (one sample into ~/.config/neohtop/neohtop.db)

[Service]
Type=oneshot
ExecStart=${args.map(unitQuote).join(' ')}
StandardOutput=append:${logPath()}
StandardError=append:${logPath()}
`
}

export function renderTimerUnit(intervalSecs: number): string {
  return `[Unit]
Description=Run the neohtop metrics recorder every ${intervalSecs}s

[Timer]
OnBootSec=2min
OnUnitActiveSec=${intervalSecs}s

[Install]
WantedBy=timers.target
`
}

function run(cmd: string, args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' })
    return { ok: true, output }
  } catch (err) {
    return { ok: false, output: (err as { stderr?: string }).stderr ?? String(err) }
  }
}

const launchctl = (args: string[]) => run('launchctl', args)
const systemctl = (args: string[]) => run('systemctl', ['--user', ...args])

const domain = () => `gui/${process.getuid?.() ?? 501}`

export interface InstallResult {
  scheduler: 'launchd' | 'systemd'
  files: string[]
  command: string[]
}

export function install(intervalSecs: number): InstallResult {
  const command = recordCommand()
  if (process.platform === 'darwin') {
    const path = plistPath()
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
    writeFileSync(path, renderPlist(command, intervalSecs))
    launchctl(['bootout', `${domain()}/${LABEL}`]) // ignore failure — may not be loaded
    const boot = launchctl(['bootstrap', domain(), path])
    if (!boot.ok) throw new Error(`launchctl bootstrap failed: ${boot.output}`)
    return { scheduler: 'launchd', files: [path], command }
  }
  if (process.platform === 'linux') {
    mkdirSync(systemdUserDir(), { recursive: true })
    writeFileSync(servicePath(), renderServiceUnit(command))
    writeFileSync(timerPath(), renderTimerUnit(intervalSecs))
    const reload = systemctl(['daemon-reload'])
    if (!reload.ok) throw new Error(`systemctl daemon-reload failed: ${reload.output}`)
    const enable = systemctl(['enable', '--now', `${UNIT}.timer`])
    if (!enable.ok) throw new Error(`systemctl enable failed: ${enable.output}`)
    return { scheduler: 'systemd', files: [servicePath(), timerPath()], command }
  }
  throw new Error(`service install is not supported on ${process.platform} (macOS + Linux only)`)
}

export function uninstall(): { scheduler: 'launchd' | 'systemd'; removed: boolean } {
  if (process.platform === 'darwin') {
    launchctl(['bootout', `${domain()}/${LABEL}`])
    const path = plistPath()
    const existed = existsSync(path)
    rmSync(path, { force: true })
    return { scheduler: 'launchd', removed: existed }
  }
  if (process.platform === 'linux') {
    systemctl(['disable', '--now', `${UNIT}.timer`])
    const existed = existsSync(servicePath()) || existsSync(timerPath())
    rmSync(servicePath(), { force: true })
    rmSync(timerPath(), { force: true })
    systemctl(['daemon-reload'])
    return { scheduler: 'systemd', removed: existed }
  }
  throw new Error(`service uninstall is not supported on ${process.platform}`)
}

export interface StatusResult {
  scheduler: 'launchd' | 'systemd'
  installed: boolean
  loaded: boolean
  files: string[]
}

export function status(): StatusResult {
  if (process.platform === 'darwin') {
    const path = plistPath()
    const print = launchctl(['print', `${domain()}/${LABEL}`])
    return { scheduler: 'launchd', installed: existsSync(path), loaded: print.ok, files: [path] }
  }
  if (process.platform === 'linux') {
    const active = systemctl(['is-active', `${UNIT}.timer`])
    return {
      scheduler: 'systemd',
      installed: existsSync(servicePath()) && existsSync(timerPath()),
      loaded: active.ok,
      files: [servicePath(), timerPath()],
    }
  }
  throw new Error(`service status is not supported on ${process.platform}`)
}
