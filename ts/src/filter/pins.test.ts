import { describe, expect, test } from 'bun:test'
import { splitPinned } from './pins.ts'

const row = (name: string, command = name) => ({ name, command, pid: name.length })

describe('splitPinned', () => {
  const rows = [
    row('chrome', '/opt/chrome'),
    row('node', 'node server.js'),
    row('postgres', '/usr/lib/postgresql/bin/postgres'),
  ]

  test('floats matches in pattern order and keeps the sort inside a pattern', () => {
    const split = splitPinned(rows, ['postgres', 'node'])
    expect(split.pinned.map((r) => r.name)).toEqual(['postgres', 'node'])
    expect(split.rest.map((r) => r.name)).toEqual(['chrome'])
    expect(split.missing).toEqual([])
  })

  test('a bare word does not match inside a longer word', () => {
    const split = splitPinned([row('nodex', 'nodex'), row('node', 'node')], ['node'])
    expect(split.pinned.map((r) => r.name)).toEqual(['node'])
    expect(split.missing).toEqual([])
  })

  test('a pattern with no process is missing', () => {
    expect(splitPinned(rows, ['redis']).missing).toEqual(['redis'])
    expect(splitPinned(rows, ['redis']).pinned).toEqual([])
  })

  test('a bare word does not match a command line that only echoes the pin', () => {
    const split = splitPinned(
      [row('zsh', 'zsh -c "sloppytop top --pin postgres"'), row('postgres', 'postgres: checkpointer')],
      ['postgres'],
    )
    expect(split.pinned.map((r) => r.name)).toEqual(['postgres'])
  })

  test('a path pattern matches the command', () => {
    const split = splitPinned([row('postgres', '/usr/lib/postgresql/bin/postgres')], [
      '/usr/lib/postgresql',
    ])
    expect(split.pinned.map((r) => r.name)).toEqual(['postgres'])
  })
})
