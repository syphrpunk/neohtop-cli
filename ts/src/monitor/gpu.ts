// Per-process GPU time from AGXDeviceUserClient AppUsage. Each client lists
// one or more `accumulatedGPUTime` counters (nanoseconds). A process may
// own several clients; they are summed. The published field is the accrual
// over the sample window, not a percent and not a per-engine breakdown.

/** Sum `accumulatedGPUTime` per pid from `ioreg -r -c AGXDeviceUserClient -d 0`. */
export function parseAgxGpuTime(text: string): Map<number, bigint> {
  const out = new Map<number, bigint>()
  for (const block of text.split(/\n(?=\+-o AGXDeviceUserClient)/)) {
    const pid = block.match(/"IOUserClientCreator" = "pid (\d+),/)
    if (!pid) continue
    const id = Number(pid[1])
    let sum = out.get(id) ?? 0n
    for (const m of block.matchAll(/accumulatedGPUTime"=(\d+)/g)) sum += BigInt(m[1]!)
    out.set(id, sum)
  }
  return out
}

/**
 * Milliseconds accrued between two cumulative samples. A pid missing from
 * either side, or a counter that went backwards, is omitted. A measured 0
 * means the context was present and idle. `elapsedSec <= 0` returns nothing.
 */
export function gpuTimeDeltas(
  prev: Map<number, bigint> | undefined,
  next: Map<number, bigint> | undefined,
  elapsedSec: number,
): Map<number, number> {
  const out = new Map<number, number>()
  if (!prev || !next || elapsedSec <= 0) return out
  for (const [pid, ns] of next) {
    const was = prev.get(pid)
    if (was === undefined) continue
    const delta = ns - was
    if (delta < 0n) continue
    out.set(pid, Math.round((Number(delta) / 1e6) * 1000) / 1000)
  }
  return out
}
