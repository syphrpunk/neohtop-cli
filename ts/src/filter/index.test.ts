import { describe, expect, test } from 'bun:test'
import type { ProcessInfo } from '../monitor/types.ts'
import { FilterQueryError, filterProcesses, sortProcesses } from './index.ts'

function proc(overrides: Partial<ProcessInfo>): ProcessInfo {
  return {
    pid: 1,
    ppid: 0,
    name: 'proc',
    cpu_usage: 0,
    memory_bytes: 0,
    status: 'Running',
    user: 'root',
    command: '/bin/proc',
    runtime_secs: 0,
    disk_read_bytes: 0,
    disk_write_bytes: 0,
    ...overrides,
  }
}

const procs = [
  proc({ pid: 100, name: 'chrome', command: '/opt/chrome --headless', cpu_usage: 40, memory_bytes: 500, user: 'dk' }),
  proc({ pid: 200, name: 'node', command: 'node server.js', cpu_usage: 10, memory_bytes: 900, user: 'dk' }),
  proc({ pid: 300, name: 'systemd', command: '/sbin/systemd', cpu_usage: 1, memory_bytes: 100, user: 'root' }),
]

describe('filterProcesses', () => {
  test('regex against name', () => {
    expect(filterProcesses(procs, '^chr').map((p) => p.pid)).toEqual([100])
  })

  test('regex against command', () => {
    expect(filterProcesses(procs, 'server\\.js').map((p) => p.pid)).toEqual([200])
  })

  test('matches pid as string', () => {
    expect(filterProcesses(procs, '300').map((p) => p.pid)).toEqual([300])
  })

  test('case-insensitive', () => {
    expect(filterProcesses(procs, 'CHROME').map((p) => p.pid)).toEqual([100])
  })

  test('invalid regex falls back to escaped literal', () => {
    expect(filterProcesses(procs, '[chrome').length).toBe(0)
    const withBracket = [...procs, proc({ pid: 400, name: 'x', command: 'weird [chrome thing' })]
    expect(filterProcesses(withBracket, '[chrome').map((p) => p.pid)).toEqual([400])
  })

  test('bare word does not match inside longer words', () => {
    const withBundle = [
      ...procs,
      proc({ pid: 500, name: 'powerd', command: '/System/powerd.bundle/powerd' }),
      proc({ pid: 600, name: 'bun', command: '/opt/bun run dev' }),
    ]
    expect(filterProcesses(withBundle, 'bun').map((p) => p.pid)).toEqual([600])
  })

  test('bare word still matches path segments and word boundaries', () => {
    const list = [
      proc({ pid: 700, name: 'sh', command: '/bin/bun x' }),
      proc({ pid: 701, name: 'sh', command: 'bunx thing' }),
    ]
    expect(filterProcesses(list, 'bun').map((p) => p.pid)).toEqual([700])
  })

  test('bare word with dot is literal (node.js does not match nodexjs)', () => {
    const list = [
      proc({ pid: 800, name: 'a', command: 'run node.js now' }),
      proc({ pid: 801, name: 'b', command: 'run nodexjs now' }),
    ]
    expect(filterProcesses(list, 'node.js').map((p) => p.pid)).toEqual([800])
  })

  test('explicit regex keeps raw semantics', () => {
    const withBundle = [...procs, proc({ pid: 500, name: 'powerd', command: '/x/powerd.bundle/y' })]
    expect(filterProcesses(withBundle, 'bun.*le').map((p) => p.pid)).toEqual([500])
  })

  test('user filter', () => {
    expect(filterProcesses(procs, undefined, 'root').map((p) => p.pid)).toEqual([300])
  })

  test('alternation like the Go TUI search', () => {
    expect(filterProcesses(procs, 'node|systemd').map((p) => p.pid)).toEqual([200, 300])
  })

  test('commas OR text terms', () => {
    expect(filterProcesses(procs, 'chrome, node').map((p) => p.pid)).toEqual([100, 200])
  })

  test('predicates AND with the text terms', () => {
    expect(filterProcesses(procs, 'chrome, node, cpu>20').map((p) => p.pid)).toEqual([100])
    expect(filterProcesses(procs, 'mem>800').map((p) => p.pid)).toEqual([200])
    expect(filterProcesses(procs, 'mem>=900, cpu>=10').map((p) => p.pid)).toEqual([200])
    expect(filterProcesses(procs, 'pid:300').map((p) => p.pid)).toEqual([300])
  })

  test('memory sizes use 1024-based units', () => {
    const big = proc({ pid: 900, name: 'big', command: 'big', memory_bytes: 2 * 1024 ** 3 })
    expect(filterProcesses([...procs, big], 'mem>1G').map((p) => p.pid)).toEqual([900])
  })

  test('a quoted term keeps a comma and is not a predicate', () => {
    const listed = [
      ...procs,
      proc({ pid: 401, name: 'x', command: 'sees a,b here', cpu_usage: 1 }),
      proc({ pid: 402, name: 'y', command: 'cpu>50 literal', cpu_usage: 1 }),
    ]
    expect(filterProcesses(listed, '"a,b"').map((p) => p.pid)).toEqual([401])
    expect(filterProcesses(listed, '"cpu>50"').map((p) => p.pid)).toEqual([402])
  })

  test('invalid and unknown predicates throw', () => {
    expect(() => filterProcesses(procs, 'cpu>nope')).toThrow(FilterQueryError)
    expect(() => filterProcesses(procs, 'port:80')).toThrow(FilterQueryError)
    expect(() => filterProcesses(procs, 'user:dk')).toThrow(FilterQueryError)
    expect(() => filterProcesses(procs, 'chrome,')).toThrow(FilterQueryError)
    expect(() => filterProcesses(procs, '"chrome')).toThrow(FilterQueryError)
  })
})

describe('sortProcesses', () => {
  test('cpu desc default', () => {
    expect(sortProcesses(procs).map((p) => p.pid)).toEqual([100, 200, 300])
  })

  test('memory desc', () => {
    expect(sortProcesses(procs, 'memory').map((p) => p.pid)).toEqual([200, 100, 300])
  })

  test('name asc', () => {
    expect(sortProcesses(procs, 'name', 'asc').map((p) => p.name)).toEqual([
      'chrome',
      'node',
      'systemd',
    ])
  })

  test('stable pid tiebreak', () => {
    const tied = [proc({ pid: 5, cpu_usage: 1 }), proc({ pid: 3, cpu_usage: 1 })]
    expect(sortProcesses(tied, 'cpu').map((p) => p.pid)).toEqual([3, 5])
  })

  test('does not mutate input', () => {
    const before = procs.map((p) => p.pid)
    sortProcesses(procs, 'memory')
    expect(procs.map((p) => p.pid)).toEqual(before)
  })
})
