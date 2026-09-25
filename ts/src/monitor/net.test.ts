import { describe, expect, test } from 'bun:test'
import { netRates, parseDarwinNetstat, parseSs } from './net.ts'

const DARWIN = `
Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address Foreign Address (state) rxbytes txbytes rhiwat shiwat process:pid state
tcp4  1228  0  172.16.0.2.59005  104.18.4.71.443  ESTABLISHED  8246  450  131072  131396  Cloudflare WARP:1614  00102 00000000
tcp6  0  0  2606:4700::.58993  2606:50c0:8000::.443  ESTABLISHED  100  40  131072  131672  grok-1.0.41-maco:3116  00102
tcp4  0  0  *.23334  *.*  LISTEN  0  0  131072  131072  Clawd on Desk:95331  00100
udp4  0  0  *.5353  *.*  3779416  0  786896  9216  Brave Browser He:768  00100
not a row
`

describe('parseDarwinNetstat', () => {
  const rows = parseDarwinNetstat(DARWIN)

  test('tcp with a spaced process name, udp without a state, listen', () => {
    expect(rows.map((r) => [r.proto, r.name, r.pid, r.rxBytes, r.state])).toEqual([
      ['tcp4', 'Cloudflare WARP', 1614, 8246, 'ESTABLISHED'],
      ['tcp6', 'grok-1.0.41-maco', 3116, 100, 'ESTABLISHED'],
      ['tcp4', 'Clawd on Desk', 95331, 0, 'LISTEN'],
      ['udp4', 'Brave Browser He', 768, 3779416, undefined],
    ])
  })
})

const SS = `ESTAB 0 0 10.0.0.5:443 93.184.216.34:54321 users:(("Brave Browser",pid=4242,fd=18))
	 cubic bytes_sent:5000 bytes_acked:5000 bytes_received:9000
ESTAB 0 0 10.0.0.5:1 1.1.1.1:2
	 bytes_sent:1 bytes_received:1
`

describe('parseSs', () => {
  test('reads byte counters and skips a socket with no process', () => {
    expect(parseSs(SS, 'tcp')).toEqual([
      {
        proto: 'tcp',
        local: '10.0.0.5:443',
        remote: '93.184.216.34:54321',
        state: 'ESTAB',
        pid: 4242,
        name: 'Brave Browser',
        rxBytes: 9000,
        txBytes: 5000,
      },
    ])
  })
})

describe('netRates', () => {
  const base = {
    proto: 'tcp4',
    local: 'a',
    remote: 'b',
    pid: 1,
    name: 'n',
    rxBytes: 1000,
    txBytes: 500,
  }

  test('delta over the window, idle and reset rows dropped', () => {
    const next = { ...base, rxBytes: 1500, txBytes: 500 }
    const idle = { ...base, proto: 'udp4', rxBytes: 10, txBytes: 10 }
    const reset = { ...base, local: 'c', rxBytes: 1, txBytes: 9 }
    const rows = netRates([base, idle, { ...reset, rxBytes: 50 }], [next, idle, reset], 0.5)
    expect(rows).toEqual([
      {
        proto: 'tcp4',
        local: 'a',
        remote: 'b',
        pid: 1,
        name: 'n',
        rx_bytes_per_s: 1000,
        tx_bytes_per_s: 0,
      },
    ])
  })
})
