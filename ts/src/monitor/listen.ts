// Local listening TCP sockets. Not a remote scan, not a packet capture,
// and not stored by `record` or `service`. A missing tool is an error so
// an empty table is never a stand-in for "could not look". Sockets the
// tool cannot attribute omit pid and name. A measured empty list stays empty.

import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'

export class ListenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ListenError'
  }
}

export interface ListenSocket {
  protocol: string
  port: number
  pid?: number
  name?: string
}

function portOf(address: string): number | undefined {
  const match = /:(\d+)$/.exec(address)
  if (!match) return undefined
  const port = Number(match[1])
  if (!Number.isInteger(port) || port < 0 || port > 65535) return undefined
  return port
}

function finish(rows: ListenSocket[]): ListenSocket[] {
  const seen = new Set<string>()
  const out: ListenSocket[] = []
  for (const row of rows) {
    const key = `${row.protocol}\0${row.port}\0${row.pid ?? ''}\0${row.name ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  out.sort(
    (a, b) => a.port - b.port || (a.pid ?? -1) - (b.pid ?? -1) || a.protocol.localeCompare(b.protocol),
  )
  return out
}

/** `lsof -n -P -iTCP -sTCP:LISTEN -F pcnPt`. Established rows (`->`) are skipped. */
export function parseLsofListen(text: string): ListenSocket[] {
  const rows: ListenSocket[] = []
  let pid: number | undefined
  let name: string | undefined
  let protocol: string | undefined
  let type: string | undefined
  let skipPid = false
  for (const line of text.split('\n')) {
    if (!line) continue
    const id = line[0]
    const value = line.slice(1)
    if (id === 'p') {
      const next = Number(value)
      // lsof uses pid 0 when it cannot see the process. Drop that block.
      skipPid = !(Number.isInteger(next) && next > 0)
      pid = skipPid ? undefined : next
      name = undefined
      protocol = undefined
      type = undefined
      continue
    }
    if (id === 'c') {
      name = value.trim() || undefined
      continue
    }
    if (id === 'P') {
      protocol = value.trim().toLowerCase()
      continue
    }
    if (id === 't') {
      type = value.trim()
      continue
    }
    if (id !== 'n' || skipPid || !protocol || value.includes('->')) continue
    const port = portOf(value)
    if (port === undefined) continue
    let family = protocol
    if (type === 'IPv6' && !family.endsWith('6')) family = `${family}6`
    if (type === 'IPv4') family = family.replace(/6$/, '')
    const row: ListenSocket = { protocol: family, port }
    if (pid !== undefined) row.pid = pid
    if (name) row.name = name
    rows.push(row)
  }
  return finish(rows)
}

/** `ss -H -ltnp`. A row with no process still counts; pid and name are omitted. */
export function parseSsListen(text: string): ListenSocket[] {
  const rows: ListenSocket[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('State') || trimmed.startsWith('Netid')) continue
    const parts = trimmed.split(/\s+/)
    let stateAt = 0
    if (parts[0] === 'tcp' || parts[0] === 'udp') stateAt = 1
    if (parts[stateAt] !== 'LISTEN') continue
    const local = parts[stateAt + 3]
    if (!local) continue
    const port = portOf(local)
    if (port === undefined) continue
    const v6 = local.startsWith('[')
    const row: ListenSocket = { protocol: v6 ? 'tcp6' : 'tcp', port }
    const proc = trimmed.match(/users:\(\("([^"]*)",pid=(\d+)/)
    if (proc) {
      const pid = Number(proc[2])
      if (Number.isInteger(pid) && pid > 0) row.pid = pid
      if (proc[1]) row.name = proc[1]
    }
    rows.push(row)
  }
  return finish(rows)
}

/** Windows `netstat -ano -p tcp`. LISTENING rows only. Pid 0 is omitted. */
export function parseNetstatListen(text: string): ListenSocket[] {
  const rows: ListenSocket[] = []
  for (const line of text.split('\n')) {
    const match = /^(TCP|UDP)\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line.trim())
    if (!match || match[1]!.toUpperCase() !== 'TCP') continue
    const local = match[2]!
    const port = portOf(local)
    if (port === undefined) continue
    const row: ListenSocket = { protocol: local.includes('[') ? 'tcp6' : 'tcp', port }
    const pid = Number(match[3])
    if (Number.isInteger(pid) && pid > 0) row.pid = pid
    rows.push(row)
  }
  return finish(rows)
}

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch (err) {
    const failure = err as { code?: string; status?: number; stdout?: string | Buffer; stderr?: string | Buffer }
    if (failure.code === 'ENOENT') {
      throw new ListenError(`${cmd} is not available. neohtop listen does not escalate privileges.`)
    }
    const stdout =
      typeof failure.stdout === 'string'
        ? failure.stdout
        : Buffer.isBuffer(failure.stdout)
          ? failure.stdout.toString('utf8')
          : ''
    if (stdout.trim() !== '') return stdout
    if (failure.status === 0 || failure.status === 1) return ''
    const stderr =
      typeof failure.stderr === 'string'
        ? failure.stderr
        : Buffer.isBuffer(failure.stderr)
          ? failure.stderr.toString('utf8')
          : ''
    const detail = stderr.trim().split('\n')[0]
    throw new ListenError(
      `${cmd} failed${detail ? `: ${detail}` : ''}. neohtop listen does not escalate privileges.`,
    )
  }
}

/** Listening TCP sockets on this machine. Throws `ListenError` when the tool is missing. */
export function listeningSockets(): ListenSocket[] {
  switch (platform()) {
    case 'darwin':
      return parseLsofListen(run('lsof', ['-n', '-P', '-iTCP', '-sTCP:LISTEN', '-F', 'pcnPt']))
    case 'linux':
      return parseSsListen(run('ss', ['-H', '-ltnp']))
    case 'win32':
      return parseNetstatListen(run('netstat', ['-ano', '-p', 'tcp']))
    default:
      throw new ListenError(`local listening sockets are not available on ${platform()}.`)
  }
}
