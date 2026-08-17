// Braille sparklines — port of cli/view/sparkline.go (data → string only;
// no ANSI color here, so the output embeds cleanly in any --format).
//
// Each character is one data point; the braille dot pattern encodes the
// value on 5 vertical levels using the 2×4 braille grid:
//   ⠀ empty, ⣀ bottom row, ⣤ two rows, ⣶ three rows, ⣿ full

const LEVELS = ['⠀', '⣀', '⣤', '⣶', '⣿'] as const

/** Dim track character used to left-pad when there are fewer values than width. */
const TRACK = '⠤'

function levelFor(v: number, max: number): string {
  if (!Number.isFinite(v) || v <= 0 || max <= 0) return LEVELS[0]
  let level = Math.floor((v / max) * 4)
  if (level < 1) level = 1 // show at least ⣀ for non-zero values (matches Go)
  if (level > 4) level = 4
  return LEVELS[level] ?? LEVELS[4]
}

export interface SparklineOptions {
  /** Scale ceiling. Defaults to the max of the values (0 → all-empty). */
  max?: number
  /** Fixed output width: longer series keep the most recent points, shorter ones get a left track pad. */
  width?: number
}

/**
 * Render values (oldest first) as a braille sparkline string.
 * With no width, output length equals the series length.
 */
export function sparkline(values: number[], opts: SparklineOptions = {}): string {
  const max = opts.max ?? Math.max(0, ...values)
  let vals = values
  let pad = 0
  if (opts.width !== undefined) {
    if (vals.length > opts.width) vals = vals.slice(vals.length - opts.width)
    pad = opts.width - vals.length
  }
  return TRACK.repeat(pad) + vals.map((v) => levelFor(v, max)).join('')
}
