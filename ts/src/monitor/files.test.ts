import { describe, expect, test } from 'bun:test'
import { applySocketProtocols, parseLsofFields, parseProcFd, socketProtocols } from './files.ts'

const LSOF = `p42
cnode
fcwd
tDIR
n/Users/dk/proj
f0
tCHR
n/dev/null
f3
tIPv4
PTCP
n127.0.0.1:3000->127.0.0.1:4000
f4
tIPv6
PTCP
n*:443
f5
tFIFO
`

describe('parseLsofFields', () => {
  test('keeps fd, type, name, and protocol, and skips a file with no name', () => {
    expect(parseLsofFields(LSOF)).toEqual([
      { fd: 'cwd', type: 'DIR', name: '/Users/dk/proj' },
      { fd: '0', type: 'CHR', name: '/dev/null' },
      { fd: '3', type: 'IPv4', protocol: 'TCP', name: '127.0.0.1:3000->127.0.0.1:4000' },
      { fd: '4', type: 'IPv6', protocol: 'TCP', name: '*:443' },
    ])
  })

  test('an empty measurement is an empty list', () => {
    expect(parseLsofFields('')).toEqual([])
  })
})

describe('parseProcFd', () => {
  test('types sockets and pipes and leaves paths untyped', () => {
    expect(
      parseProcFd([
        { fd: '0', target: '/dev/null' },
        { fd: '1', target: 'pipe:[9]' },
        { fd: '2', target: 'socket:[42]' },
        { fd: '3', target: 'anon_inode:[eventfd]' },
        { fd: '', target: '/skip' },
      ]),
    ).toEqual([
      { fd: '0', name: '/dev/null' },
      { fd: '1', type: 'pipe', name: 'pipe:[9]' },
      { fd: '2', type: 'socket', name: 'socket:[42]' },
      { fd: '3', type: 'anon', name: 'anon_inode:[eventfd]' },
    ])
  })
})

const TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 42 1 00000000 100 0 0 10 0
   1: 00000000:0000 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 0 1 00000000 100 0 0 10 0
`

describe('socket protocols', () => {
  test('annotates a socket inode and ignores inode 0', () => {
    const protocols = socketProtocols([{ protocol: 'tcp', text: TCP }])
    expect(protocols.get('42')).toBe('tcp')
    expect(protocols.has('0')).toBe(false)
    const files = applySocketProtocols(
      [
        { fd: '2', type: 'socket', name: 'socket:[42]' },
        { fd: '4', type: 'socket', name: 'socket:[99]' },
      ],
      protocols,
    )
    expect(files[0]?.protocol).toBe('tcp')
    expect(files[1]?.protocol).toBeUndefined()
  })
})
