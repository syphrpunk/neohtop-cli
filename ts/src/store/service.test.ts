import { describe, expect, test } from 'bun:test'
import { LABEL, UNIT, renderPlist, renderServiceUnit, renderTimerUnit } from './service.ts'

describe('launchd plist', () => {
  test('embeds label, absolute command, and interval', () => {
    const plist = renderPlist(['/usr/local/bin/neohtop', 'record'], 3600)
    expect(plist).toContain(`<string>${LABEL}</string>`)
    expect(plist).toContain('<string>/usr/local/bin/neohtop</string>')
    expect(plist).toContain('<string>record</string>')
    expect(plist).toContain('<integer>3600</integer>')
  })

  test('xml-escapes paths', () => {
    const plist = renderPlist(['/tmp/a&b/neohtop', 'record'], 60)
    expect(plist).toContain('/tmp/a&amp;b/neohtop')
  })
})

describe('systemd units', () => {
  test('service unit runs the command as oneshot', () => {
    const unit = renderServiceUnit(['/usr/local/bin/neohtop', 'record'])
    expect(unit).toContain('Type=oneshot')
    expect(unit).toContain('ExecStart=/usr/local/bin/neohtop record')
  })

  test('args with spaces are quoted', () => {
    const unit = renderServiceUnit(['/home/d k/.proto/bun', '/home/d k/src/index.ts', 'record'])
    expect(unit).toContain('ExecStart="/home/d k/.proto/bun" "/home/d k/src/index.ts" record')
  })

  test('timer unit fires on the requested interval and installs to timers.target', () => {
    const timer = renderTimerUnit(1800)
    expect(timer).toContain('OnUnitActiveSec=1800s')
    expect(timer).toContain('WantedBy=timers.target')
    expect(UNIT).toBe('neohtop-record')
  })
})
