// Byte and duration formatting matched to cli/view/format.go.
// Width is counted in Unicode code points. Braille and the tree marks are one cell wide.

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const COMPACT_UNITS = ['B', 'K', 'M', 'G', 'T'] as const

export function widthOf(text: string): number {
  return [...text].length
}

export function clip(text: string, width: number): string {
  if (width <= 0) return ''
  const chars = [...text]
  if (chars.length <= width) return chars.join('')
  if (width === 1) return chars[0] ?? ''
  return `${chars.slice(0, width - 1).join('')}…`
}

export function padRight(text: string, width: number): string {
  const shown = clip(text, width)
  const gap = width - widthOf(shown)
  return gap > 0 ? shown + ' '.repeat(gap) : shown
}

export function padLeft(text: string, width: number): string {
  const shown = clip(text, width)
  const gap = width - widthOf(shown)
  return gap > 0 ? ' '.repeat(gap) + shown : shown
}

export function formatBytes(bytes: number): string {
  let value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  let idx = 0
  while (value >= 1024 && idx < BYTE_UNITS.length - 1) {
    value /= 1024
    idx++
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[idx]}`
}

export function formatBytesCompact(bytes: number): string {
  const safe = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  let value = safe
  let idx = 0
  while (value >= 1024 && idx < COMPACT_UNITS.length - 1) {
    value /= 1024
    idx++
  }
  if (idx === 0) return `${Math.round(safe)}${COMPACT_UNITS[idx]}`
  if (value >= 100) return `${value.toFixed(0)}${COMPACT_UNITS[idx]}`
  return `${value.toFixed(1)}${COMPACT_UNITS[idx]}`
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

/** Package power for one rail. A measured 0 stays `0 W`. Rails are never added together. */
export function formatWatts(watts: number): string {
  if (!Number.isFinite(watts)) return '—'
  if (watts === 0) return '0 W'
  return `${watts.toFixed(2)} W`
}

export function formatRuntime(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  if (whole < 60) return `${whole}s`
  if (whole < 3600) return `${Math.floor(whole / 60)}m ${whole % 60}s`
  if (whole < 86400) return `${Math.floor(whole / 3600)}h ${Math.floor((whole % 3600) / 60)}m`
  return `${Math.floor(whole / 86400)}d ${Math.floor((whole % 86400) / 3600)}h`
}

/** Drop control characters so one cell cannot move the rest of the row. */
export function plain(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, '')
}
