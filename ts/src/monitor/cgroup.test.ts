import { describe, expect, test } from 'bun:test'
import { parseCgroupPath } from './cgroup.ts'

describe('cgroup2 path', () => {
  test('uses the 0:: line and ignores cgroup1', () => {
    expect(parseCgroupPath('0::/user.slice/user-501.slice\n')).toBe('/user.slice/user-501.slice')
    expect(
      parseCgroupPath('12:cpu,cpuacct:/user.slice\n0::/system.slice/app.scope\n'),
    ).toBe('/system.slice/app.scope')
    expect(parseCgroupPath('0::/\n')).toBe('/')
    expect(parseCgroupPath('0::\n')).toBe('/')
  })

  test('cgroup1-only and empty files are omitted', () => {
    expect(parseCgroupPath('1:name=systemd:/user.slice\n')).toBeUndefined()
    expect(parseCgroupPath('')).toBeUndefined()
  })
})
