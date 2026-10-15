import { describe, expect, test } from 'bun:test'
import { parseLsofListen, parseNetstatListen, parseSsListen } from './listen.ts'

const LSOF = `p95331
cClawd on Desk
tIPv4
PTCP
n*:23334
p123
csshd
tIPv6
PTCP
n*:22
tIPv4
PTCP
n127.0.0.1:22
p7
cnode
PTCP
n127.0.0.1:3000->127.0.0.1:4000
p0
cskip
PTCP
n*:9
`

describe('parseLsofListen', () => {
  test('reads listen rows and skips an established connection', () => {
    expect(parseLsofListen(LSOF)).toEqual([
      { protocol: 'tcp', port: 22, pid: 123, name: 'sshd' },
      { protocol: 'tcp6', port: 22, pid: 123, name: 'sshd' },
      { protocol: 'tcp', port: 23334, pid: 95331, name: 'Clawd on Desk' },
    ])
  })

  test('an empty measurement is an empty list', () => {
    expect(parseLsofListen('')).toEqual([])
  })
})

const SS = `LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))
LISTEN 0 128 [::]:443 [::]:* users:(("nginx",pid=2,fd=5))
LISTEN 0 128 127.0.0.1:9 0.0.0.0:*
ESTAB 0 0 10.0.0.5:443 1.1.1.1:2 users:(("nginx",pid=2,fd=6))
`

describe('parseSsListen', () => {
  test('keeps a listener with no process and drops established rows', () => {
    expect(parseSsListen(SS)).toEqual([
      { protocol: 'tcp', port: 9 },
      { protocol: 'tcp', port: 22, pid: 1, name: 'sshd' },
      { protocol: 'tcp6', port: 443, pid: 2, name: 'nginx' },
    ])
  })
})

const NETSTAT = `  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1480
  TCP    [::]:135               [::]:0                 LISTENING       1480
  TCP    127.0.0.1:5037         0.0.0.0:0              LISTENING       0
  TCP    10.0.0.5:443           1.1.1.1:2              ESTABLISHED     9
  UDP    0.0.0.0:53             *:*                                    1
`

describe('parseNetstatListen', () => {
  test('tcp LISTENING only, and pid 0 is omitted', () => {
    expect(parseNetstatListen(NETSTAT)).toEqual([
      { protocol: 'tcp', port: 135, pid: 1480 },
      { protocol: 'tcp6', port: 135, pid: 1480 },
      { protocol: 'tcp', port: 5037 },
    ])
  })
})
