// Group score and leak flags over recorded process samples.
// Memory is RSS: the store has no physical-footprint counter, and the
// result says so. Leak thresholds follow a sustained linear climb
// (about 8 KB/s, r², a 20-minute minimum, 12 samples). The gap limit is
// two hours rather than a few minutes, because the recorder is hourly;
// a hole longer than that breaks the series.

export interface SeriesPoint {
  /** Unix milliseconds. */
  at: number
  bytes: number
}

export interface LeakConfig {
  minimumDurationMs: number
  /** Bytes per second. */
  minimumSlope: number
  minimumRSquared: number
  minimumSamples: number
  minimumTotalGrowth: number
  /** Fraction of the first sample. 0.05 means 5%. */
  minimumRelativeGrowth: number
  maximumGapMs: number
  recentDurationMs: number
}

export const LEAK_DEFAULTS: LeakConfig = {
  minimumDurationMs: 20 * 60 * 1000,
  minimumSlope: 8 * 1024,
  minimumRSquared: 0.85,
  minimumSamples: 12,
  minimumTotalGrowth: 32 * 1024 * 1024,
  minimumRelativeGrowth: 0.05,
  maximumGapMs: 2 * 60 * 60 * 1000,
  recentDurationMs: 3 * 60 * 60 * 1000,
}

export interface LeakFinding {
  slopeBytesPerSecond: number
  rSquared: number
  durationSecs: number
  totalGrowthBytes: number
  samples: number
}

export interface Fit {
  slope: number
  rSquared: number
}

/** Ordinary least squares. Null when the points do not span time. */
export function linearFit(points: { x: number; y: number }[]): Fit | null {
  const n = points.length
  if (n < 2) return null
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumXY = 0
  for (const p of points) {
    sumX += p.x
    sumY += p.y
    sumXX += p.x * p.x
    sumXY += p.x * p.y
  }
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return null
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  let ssRes = 0
  let ssTot = 0
  const meanY = sumY / n
  for (const p of points) {
    const predicted = intercept + slope * p.x
    ssRes += (p.y - predicted) ** 2
    ssTot += (p.y - meanY) ** 2
  }
  return { slope, rSquared: ssTot === 0 ? 1 : 1 - ssRes / ssTot }
}

/**
 * A finding is a sustained climb, not a diagnosis. Short series, holes,
 * one-off jumps, and climbs that have already flattened return null.
 */
export function detectLeak(series: SeriesPoint[], config: LeakConfig = LEAK_DEFAULTS): LeakFinding | null {
  if (series.length < config.minimumSamples) return null
  const sorted = [...series].sort((a, b) => a.at - b.at)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const durationMs = last.at - first.at
  if (durationMs < config.minimumDurationMs) return null
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]!.at - sorted[i - 1]!.at
    if (gap <= 0 || gap > config.maximumGapMs) return null
  }

  const points = sorted.map((p) => ({ x: (p.at - first.at) / 1000, y: p.bytes }))
  const fit = linearFit(points)
  if (!fit || fit.slope < config.minimumSlope || fit.rSquared < config.minimumRSquared) return null

  const recent = sorted.filter((p) => last.at - p.at <= config.recentDurationMs)
  if (recent.length < 3) return null
  const recentFit = linearFit(
    recent.map((p) => ({ x: (p.at - first.at) / 1000, y: p.bytes })),
  )
  if (!recentFit || recentFit.slope < config.minimumSlope) return null

  const totalGrowth = last.bytes > first.bytes ? last.bytes - first.bytes : 0
  if (totalGrowth < config.minimumTotalGrowth) return null
  if (totalGrowth < first.bytes * config.minimumRelativeGrowth) return null

  return {
    slopeBytesPerSecond: fit.slope,
    rSquared: fit.rSquared,
    durationSecs: durationMs / 1000,
    totalGrowthBytes: totalGrowth,
    samples: sorted.length,
  }
}

export interface GroupMemberInput {
  name: string
  /** CPU percent of one core. A group may exceed 100. */
  cpuPercent: number
  memoryBytes: number
}

export interface GroupMemberScore {
  name: string
  cpuPercent: number
  memoryBytes: number
  score: number
  /** Share of the group score, 0–1. */
  share: number
}

export interface GroupScore {
  score: number
  members: GroupMemberScore[]
}

/**
 * Even blend of CPU share of the machine and memory share of RAM.
 * cpuPercent is one-core style, so it is divided by core count.
 */
export function scoreGroup(
  members: GroupMemberInput[],
  device: { cores: number; totalBytes: number },
): GroupScore {
  if (device.cores <= 0 || device.totalBytes <= 0 || members.length === 0) {
    return { score: 0, members: [] }
  }
  const scored = members.map((member) => {
    const cpuShare = member.cpuPercent / 100 / device.cores
    const memShare = member.memoryBytes / device.totalBytes
    return {
      name: member.name,
      cpuPercent: member.cpuPercent,
      memoryBytes: member.memoryBytes,
      score: (0.5 * cpuShare + 0.5 * memShare) * 100,
    }
  })
  const total = scored.reduce((sum, member) => sum + member.score, 0)
  const ranked = scored
    .map((member) => ({
      ...member,
      share: total > 0 ? member.score / total : 0,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return { score: total, members: ranked }
}
