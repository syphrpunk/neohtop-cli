import { describe, expect, test } from 'bun:test'
import { parseEtime } from './darwin.ts'

describe('parseEtime', () => {
  test('mm:ss', () => {
    expect(parseEtime('04:20')).toBe(260)
  })

  test('hh:mm:ss', () => {
    expect(parseEtime('01:02:03')).toBe(3723)
  })

  test('dd-hh:mm:ss', () => {
    expect(parseEtime('2-01:00:30')).toBe(2 * 86_400 + 3_600 + 30)
  })

  test('garbage returns 0', () => {
    expect(parseEtime('-')).toBe(0)
  })
})
