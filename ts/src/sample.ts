// One sample path for commands and the screen: probe flags, field projection, probe log.

import { snapshot } from './monitor/index.ts'
import { collectFlags, probeEntries, projectProcesses, projectSystem, type ProbeSet } from './monitor/probes.ts'
import type { ProcessInfo, SystemStats } from './monitor/types.ts'
import { loadConfig } from './store/config.ts'
import { appendProbeLog } from './store/probe-log.ts'

export interface Sample {
  system: SystemStats
  processes: ProcessInfo[]
  probes: ProbeSet
}

/** Sample, drop disabled probe fields, and append one probe-log line per enabled probe. */
export async function takeSample(sampleMs: number): Promise<Sample> {
  const probes = loadConfig().probes
  const snap = await snapshot(sampleMs, collectFlags(probes))
  const system = projectSystem(snap.system, probes)
  const processes = projectProcesses(snap.processes, probes)
  appendProbeLog(probeEntries(system, processes, probes))
  return { system, processes, probes }
}
