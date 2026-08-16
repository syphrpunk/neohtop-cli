// libproc/libc bindings via bun:ffi — ports the CGo calls in
// cli/monitor/process_darwin.go without a C toolchain. Struct offsets
// mirror <sys/proc_info.h> and <sys/resource.h>; degrade gracefully
// (nulls) if dlopen or a call fails.

import { dlopen, ptr } from 'bun:ffi'

const PROC_PIDTASKINFO = 4
const PROC_PIDVNODEPATHINFO = 9
const RUSAGE_INFO_V2 = 2
const CTL_KERN = 1
const KERN_PROCARGS2 = 49

// struct proc_taskinfo: 6× uint64 then 12× int32 = 96 bytes
const TASKINFO_SIZE = 96
// struct rusage_info_v2: uuid[16] + 18× uint64 = 160 bytes;
// ri_diskio_bytesread/written are the last two fields
const RUSAGE_V2_SIZE = 160
const RUSAGE_DISKIO_READ_OFF = 144
const RUSAGE_DISKIO_WRITE_OFF = 152
// struct vnode_info_path = vnode_info (152) + char path[1024] = 1176;
// proc_vnodepathinfo = { pvi_cdir, pvi_rdir } = 2352
const VNODE_INFO_PATH_SIZE = 1176
const VNODE_PATH_OFF = 152

function open() {
  try {
    return dlopen('libSystem.B.dylib', {
      proc_pidinfo: { args: ['i32', 'i32', 'u64', 'ptr', 'i32'], returns: 'i32' },
      proc_pid_rusage: { args: ['i32', 'i32', 'ptr'], returns: 'i32' },
      sysctl: { args: ['ptr', 'u32', 'ptr', 'ptr', 'ptr', 'usize'], returns: 'i32' },
    })
  } catch {
    return null
  }
}

const lib = process.platform === 'darwin' ? open() : null

export const available = lib !== null

export interface TaskInfo {
  virtualSize: number
  residentSize: number
  threadCount: number
}

export function taskInfo(pid: number): TaskInfo | null {
  if (!lib) return null
  const buf = new ArrayBuffer(TASKINFO_SIZE)
  const written = lib.symbols.proc_pidinfo(pid, PROC_PIDTASKINFO, 0n, ptr(buf), TASKINFO_SIZE)
  if (written < TASKINFO_SIZE) return null
  const view = new DataView(buf)
  return {
    virtualSize: Number(view.getBigUint64(0, true)),
    residentSize: Number(view.getBigUint64(8, true)),
    threadCount: view.getInt32(84, true),
  }
}

/** Cumulative disk I/O byte counters (rates are computed by Monitor) */
export function diskIO(pid: number): { read: number; write: number } | null {
  if (!lib) return null
  const buf = new ArrayBuffer(RUSAGE_V2_SIZE)
  if (lib.symbols.proc_pid_rusage(pid, RUSAGE_INFO_V2, ptr(buf)) !== 0) return null
  const view = new DataView(buf)
  return {
    read: Number(view.getBigUint64(RUSAGE_DISKIO_READ_OFF, true)),
    write: Number(view.getBigUint64(RUSAGE_DISKIO_WRITE_OFF, true)),
  }
}

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  return new TextDecoder().decode(bytes.subarray(0, end < 0 ? bytes.length : end))
}

/** Current working directory (pvi_cdir.vip_path) — needs same-user or root */
export function cwd(pid: number): string | null {
  if (!lib) return null
  const size = VNODE_INFO_PATH_SIZE * 2
  const buf = new ArrayBuffer(size)
  const written = lib.symbols.proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0n, ptr(buf), size)
  if (written < size) return null
  const path = cString(new Uint8Array(buf, VNODE_PATH_OFF, 1024))
  return path || null
}

/**
 * Environment variables via sysctl KERN_PROCARGS2 — same parse as the Go
 * port: int32 argc, exec path, argc argv strings, padding NULs, then env.
 * Only readable for same-user processes (root for others).
 */
export function environ(pid: number): string[] {
  if (!lib) return []
  const mib = new Int32Array([CTL_KERN, KERN_PROCARGS2, pid])
  const sizeBuf = new BigUint64Array(1)

  if (lib.symbols.sysctl(ptr(mib), 3, null, ptr(sizeBuf), null, 0n) !== 0) return []
  let size = Number(sizeBuf[0])
  if (size === 0) return []
  if (size > 1024 * 1024) size = 1024 * 1024

  const data = new Uint8Array(size)
  sizeBuf[0] = BigInt(size)
  if (lib.symbols.sysctl(ptr(mib), 3, ptr(data.buffer), ptr(sizeBuf), null, 0n) !== 0) return []

  return parseEnviron(data.subarray(0, Number(sizeBuf[0])))
}

export function parseEnviron(data: Uint8Array): string[] {
  if (data.length < 4) return []
  const argc = new DataView(data.buffer, data.byteOffset).getInt32(0, true)
  let pos = 4

  // Skip exec path + argc argv strings (null-terminated)
  let skipped = 0
  while (pos < data.length && skipped <= argc) {
    const nul = data.indexOf(0, pos)
    if (nul < 0) return []
    pos = nul + 1
    skipped++
  }
  // Skip padding NULs between argv and environ
  while (pos < data.length && data[pos] === 0) pos++

  const env: string[] = []
  const decoder = new TextDecoder()
  while (pos < data.length) {
    const nul = data.indexOf(0, pos)
    if (nul < 0) break
    if (nul > pos) {
      const str = decoder.decode(data.subarray(pos, nul))
      if (str.includes('=')) env.push(str)
    }
    pos = nul + 1
  }
  return env
}
