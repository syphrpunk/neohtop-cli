/** Cumulative energy, normalized to nanojoules so a delta survives large counters. */
export interface EnergyNj {
  cpu?: bigint
  gpu?: bigint
  ane?: bigint
  dram?: bigint
}

export type PowerKey = keyof EnergyNj

const NANO: Record<string, bigint> = {
  nJ: 1n,
  mJ: 1_000_000n,
  J: 1_000_000_000n,
}

/** Convert an IOReport counter using its unit label. Unknown units are skipped. */
export function toNanojoules(value: number | bigint, unit: string): bigint | null {
  const scale = NANO[unit]
  if (scale === undefined) return null
  const v = typeof value === 'bigint' ? value : BigInt(Math.trunc(value))
  if (v < 0n) return null
  return v * scale
}

/**
 * Watts between two cumulative readings. A backwards counter is a reset,
 * not a negative load. A zero delta is a real idle.
 */
export function wattsFromDelta(prev: bigint, next: bigint, seconds: number): number | null {
  if (!(seconds > 0) || next < prev) return null
  return Number(next - prev) / 1e9 / seconds
}

export function powerWatts(
  prev: EnergyNj | undefined,
  next: EnergyNj | undefined,
  seconds: number,
): Partial<Record<PowerKey, number>> {
  const out: Partial<Record<PowerKey, number>> = {}
  if (!prev || !next) return out
  for (const key of ['cpu', 'gpu', 'ane', 'dram'] as const) {
    const a = prev[key]
    const b = next[key]
    if (a === undefined || b === undefined) continue
    const watts = wattsFromDelta(a, b, seconds)
    if (watts !== null) out[key] = watts
  }
  return out
}
