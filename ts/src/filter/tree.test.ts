// Port of cli/filter/tree_test.go core cases.

import { describe, expect, test } from 'bun:test'
import type { ProcessInfo } from '../monitor/types.ts'
import { buildProcessTree } from './tree.ts'

function proc(pid: number, ppid: number, name = `p${pid}`): ProcessInfo {
  return {
    pid,
    ppid,
    name,
    cpu_usage: 0,
    memory_bytes: 0,
    status: 'Running',
    user: 'root',
    command: name,
    runtime_secs: 0,
    disk_read_bytes: 0,
    disk_write_bytes: 0,
  }
}

describe('buildProcessTree', () => {
  test('empty input', () => {
    expect(buildProcessTree([])).toEqual([])
  })

  test('single process root', () => {
    const out = buildProcessTree([proc(1, 0)])
    expect(out).toHaveLength(1)
    expect(out[0]!.tree_depth).toBe(0)
    expect(out[0]!.tree_prefix).toBe('')
  })

  test('simple parent child', () => {
    const out = buildProcessTree([proc(2, 1), proc(1, 0)])
    expect(out.map((p) => p.pid)).toEqual([1, 2])
    expect(out[1]!.tree_depth).toBe(1)
    expect(out[1]!.tree_prefix).toBe('└─ ')
  })

  test('multiple children sorted by PID, middle vs last prefix', () => {
    const out = buildProcessTree([proc(1, 0), proc(30, 1), proc(10, 1), proc(20, 1)])
    expect(out.map((p) => p.pid)).toEqual([1, 10, 20, 30])
    expect(out[1]!.tree_prefix).toBe('├─ ')
    expect(out[2]!.tree_prefix).toBe('├─ ')
    expect(out[3]!.tree_prefix).toBe('└─ ')
  })

  test('deep nesting with continuation lines', () => {
    // 1 → {2 → 4, 3}: node 4 is under a non-last child, so gets "│  "
    const out = buildProcessTree([proc(1, 0), proc(2, 1), proc(3, 1), proc(4, 2)])
    expect(out.map((p) => p.pid)).toEqual([1, 2, 4, 3])
    const p4 = out.find((p) => p.pid === 4)!
    expect(p4.tree_depth).toBe(2)
    expect(p4.tree_prefix).toBe('│  └─ ')
  })

  test('multiple roots ordered by PID', () => {
    const out = buildProcessTree([proc(50, 0), proc(1, 0), proc(51, 50)])
    expect(out.map((p) => p.pid)).toEqual([1, 50, 51])
  })

  test('orphan: parent not in list becomes root', () => {
    const out = buildProcessTree([proc(10, 999)])
    expect(out[0]!.tree_depth).toBe(0)
    expect(out[0]!.tree_prefix).toBe('')
  })

  test('cycle PID=PPID treated as root, no infinite loop', () => {
    const out = buildProcessTree([proc(5, 5)])
    expect(out).toHaveLength(1)
    expect(out[0]!.tree_depth).toBe(0)
  })

  test('mutual cycle orphans appended with "? "', () => {
    // 2↔3 cycle with no path from a root
    const out = buildProcessTree([proc(1, 0), proc(2, 3), proc(3, 2)])
    expect(out).toHaveLength(3)
    const orphans = out.filter((p) => p.tree_prefix === '? ')
    // one of the pair is reachable as "root-ish"? Neither: 2's parent (3) and
    // 3's parent (2) are both in the list, so neither is a root — both orphaned
    expect(orphans.map((p) => p.pid).sort()).toEqual([2, 3])
  })

  test('preserves process data in output', () => {
    const p = proc(7, 1, 'special')
    const out = buildProcessTree([proc(1, 0), p])
    const found = out.find((x) => x.pid === 7)!
    expect(found.name).toBe('special')
    expect(found.command).toBe('special')
  })
})
