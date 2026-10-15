// On-demand open files for one process. Not stored by `record` or `service`.
// macOS and Linux prefer `lsof -F`. Linux falls back to `/proc/<pid>/fd`
// when `lsof` is absent. A missing tool omits the list. An empty measured
// list stays empty.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { platform } from 'node:os'

export interface OpenFile {
  fd: string
  type?: string
  name: string
  protocol?: string
}

/** `lsof -F ftnP` for one process. Lines that are not a file are skipped. */
export function parseLsofFields(text: string): OpenFile[] {
  const files: OpenFile[] = []
  let cur: { fd?: string; type?: string; name?: string; protocol?: string } | null = null
  const flush = () => {
    if (!cur?.fd || !cur.name) {
      cur = null
      return
    }
    const row: OpenFile = { fd: cur.fd, name: cur.name }
    if (cur.type) row.type = cur.type
    if (cur.protocol) row.protocol = cur.protocol
    files.push(row)
    cur = null
  }
  for (const line of text.split('\n')) {
    if (!line) continue
    const id = line[0]
    const value = line.slice(1)
    if (id === 'f') {
      flush()
      cur = { fd: value }
      continue
    }
    if (!cur) continue
    if (id === 't') cur.type = value
    else if (id === 'n') cur.name = value
    else if (id === 'P') cur.protocol = value
  }
  flush()
  return files
}

/** `/proc/<pid>/fd` symlink targets. Socket and pipe kinds are typed. Paths are not. */
export function parseProcFd(links: { fd: string; target: string }[]): OpenFile[] {
  const files: OpenFile[] = []
  for (const link of links) {
    if (!link.fd || !link.target) continue
    const row: OpenFile = { fd: link.fd, name: link.target }
    if (link.target.startsWith('socket:')) row.type = 'socket'
    else if (link.target.startsWith('pipe:')) row.type = 'pipe'
    else if (link.target.startsWith('anon_inode:')) row.type = 'anon'
    files.push(row)
  }
  return files
}

/**
 * Inode → protocol from `/proc/net/{tcp,tcp6,udp,udp6}`.
 * The inode column is the 10th field. A 0 inode is skipped.
 */
export function socketProtocols(tables: { protocol: string; text: string }[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const table of tables) {
    for (const line of table.text.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 10 || !parts[0]?.endsWith(':')) continue
      const inode = parts[9]
      if (!inode || !/^\d+$/.test(inode) || inode === '0') continue
      if (!map.has(inode)) map.set(inode, table.protocol)
    }
  }
  return map
}

export function applySocketProtocols(files: OpenFile[], protocols: Map<string, string>): OpenFile[] {
  return files.map((file) => {
    const inode = /^socket:\[(\d+)\]$/.exec(file.name)
    if (!inode) return file
    const protocol = protocols.get(inode[1]!)
    return protocol ? { ...file, protocol } : file
  })
}

function lsofText(pid: number): string | undefined {
  try {
    return execFileSync('lsof', ['-n', '-P', '-p', String(pid), '-F', 'ftnP'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (err) {
    const failure = err as { code?: string; status?: number; stdout?: string | Buffer }
    if (failure.code === 'ENOENT') return undefined
    const stdout =
      typeof failure.stdout === 'string'
        ? failure.stdout
        : Buffer.isBuffer(failure.stdout)
          ? failure.stdout.toString('utf8')
          : ''
    if (stdout.trim() !== '') return stdout
    if (failure.status === 0) return ''
    return undefined
  }
}

function procFd(pid: number): OpenFile[] | undefined {
  let names: string[]
  try {
    names = readdirSync(`/proc/${pid}/fd`)
  } catch {
    return undefined
  }
  const links: { fd: string; target: string }[] = []
  for (const fd of names) {
    try {
      links.push({ fd, target: readlinkSync(`/proc/${pid}/fd/${fd}`) })
    } catch {
      // The fd disappeared between readdir and readlink.
    }
  }
  const tables: { protocol: string; text: string }[] = []
  for (const protocol of ['tcp', 'tcp6', 'udp', 'udp6']) {
    try {
      tables.push({ protocol, text: readFileSync(`/proc/net/${protocol}`, 'utf8') })
    } catch {
      // That family is not mounted.
    }
  }
  return applySocketProtocols(parseProcFd(links), socketProtocols(tables))
}

/**
 * Open files for one pid. `undefined` means the platform could not measure
 * them. `[]` means the measurement ran and found nothing.
 */
export function openFiles(pid: number): OpenFile[] | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  const text = lsofText(pid)
  if (text !== undefined) return parseLsofFields(text)
  if (platform() === 'linux') return procFd(pid)
  return undefined
}
