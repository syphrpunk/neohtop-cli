// On-demand pages. The table tick does not call these loaders.
// The probe log gets counts and flags only: no cwd, environment, or addresses.

import { openFiles } from '../monitor/files.ts'
import { hardwareInventory } from '../monitor/hardware.ts'
import { processDetail } from '../monitor/index.ts'
import { listeningSockets } from '../monitor/listen.ts'
import { sampleNet } from '../monitor/net.ts'
import {
  countEntry,
  hardwareEntry,
  procEntry,
  type ProbeLogEntry,
  type ProbeSet,
} from '../monitor/probes.ts'
import type { ProcessInfo } from '../monitor/types.ts'
import type { DetailState, HardwareView, PageState, ScreenEffect } from './state.ts'

export interface PageLoaders {
  processDetail: (pid: number) => Promise<{ cwd?: string; environ?: string[] }>
  openFiles: (pid: number) => { fd: string; type?: string; name: string; protocol?: string }[] | undefined
  sampleNet: (sampleMs: number) => Promise<PageState['net']>
  listeningSockets: () => PageState['listen']
  hardwareInventory: (opts: { refresh?: boolean }) => HardwareView
}

export interface PageContext {
  probes: ProbeSet
  sampleMs: number
  processes: ProcessInfo[]
}

export interface PagePatch {
  detail?: DetailState
  page?: PageState
  log: ProbeLogEntry[]
}

export function defaultPageLoaders(): PageLoaders {
  return {
    processDetail,
    openFiles,
    sampleNet: async (sampleMs) => sampleNet(sampleMs),
    listeningSockets: () => listeningSockets(),
    hardwareInventory: (opts) => hardwareInventory(opts),
  }
}

export function hasPageEffect(effect: ScreenEffect): boolean {
  return (
    effect.detailPid != null ||
    effect.loadEnv != null ||
    effect.loadFiles != null ||
    effect.openNet === true ||
    effect.openListen === true ||
    effect.openHardware === true ||
    effect.refreshHardware === true
  )
}

export async function fulfillPage(effect: ScreenEffect, ctx: PageContext, loaders: PageLoaders): Promise<PagePatch> {
  if (effect.openNet) return loadConnections(ctx, loaders)
  if (effect.openListen) return loadListen(ctx, loaders)
  if (effect.openHardware || effect.refreshHardware) return loadHardware(effect.refreshHardware === true, ctx, loaders)
  const pid = effect.loadFiles ?? effect.loadEnv ?? effect.detailPid
  if (pid == null) return { log: [] }
  return loadProc(pid, effect.loadEnv != null, effect.loadFiles != null, ctx, loaders)
}

async function loadProc(
  pid: number,
  wantEnv: boolean,
  wantFiles: boolean,
  ctx: PageContext,
  loaders: PageLoaders,
): Promise<PagePatch> {
  const blocked = procBlocked(ctx.probes)
  if (blocked) return { log: [], detail: { pid, loaded: true, message: blocked } }
  try {
    const detail = await loaders.processDetail(pid)
    const files = wantFiles ? loaders.openFiles(pid) : undefined
    const children = ctx.processes.filter((row) => row.ppid === pid).length
    const next: DetailState = {
      pid,
      loaded: true,
      ...(detail.cwd ? { cwd: detail.cwd } : {}),
      ...(wantEnv ? { env: detail.environ ?? [] } : {}),
      ...(wantFiles ? { files: files ?? undefined, filesOmitted: files === undefined } : {}),
    }
    return {
      detail: next,
      log: [
        procEntry({
          pid,
          children,
          hasCwd: Boolean(detail.cwd),
          fileCount: !wantFiles || files === undefined ? null : files.length,
        }),
      ],
    }
  } catch {
    return { log: [], detail: { pid, loaded: true, message: 'detail unavailable' } }
  }
}

async function loadConnections(ctx: PageContext, loaders: PageLoaders): Promise<PagePatch> {
  if (!ctx.probes.connections) return { log: [], page: off('net', 'connections') }
  try {
    const rows = (await loaders.sampleNet(ctx.sampleMs)) ?? []
    return {
      log: [countEntry('connections', rows.length)],
      page: { kind: 'net', status: 'ready', message: '', net: rows },
    }
  } catch (err) {
    return { log: [], page: failed('net', err) }
  }
}

async function loadListen(ctx: PageContext, loaders: PageLoaders): Promise<PagePatch> {
  if (!ctx.probes.listen) return { log: [], page: off('listen', 'listen') }
  try {
    const rows = loaders.listeningSockets() ?? []
    return {
      log: [countEntry('listen', rows.length)],
      page: { kind: 'listen', status: 'ready', message: '', listen: rows },
    }
  } catch (err) {
    return { log: [], page: failed('listen', err) }
  }
}

async function loadHardware(refresh: boolean, ctx: PageContext, loaders: PageLoaders): Promise<PagePatch> {
  if (!ctx.probes.hardware) return { log: [], page: off('hardware', 'hardware') }
  try {
    const report = allowHardware(loaders.hardwareInventory({ refresh }))
    return {
      log: [hardwareEntry(report)],
      page: { kind: 'hardware', status: 'ready', message: '', hardware: report },
    }
  } catch (err) {
    return { log: [], page: failed('hardware', err) }
  }
}

function procBlocked(probes: ProbeSet): string | null {
  if (!probes.proc) return probeOff('proc')
  if (!probes.processes) return probeOff('processes')
  return null
}

function probeOff(name: string): string {
  return `probe ${name} is off — sloppytop probe enable ${name}`
}

function off(kind: PageState['kind'], name: string): PageState {
  return { kind, status: 'off', message: probeOff(name) }
}

function failed(kind: PageState['kind'], err: unknown): PageState {
  const message = err instanceof Error && err.message ? err.message : 'unavailable'
  return { kind, status: 'error', message }
}

/** Copy the allowlisted inventory. Serials are not part of this view. */
function allowHardware(report: HardwareView): HardwareView {
  const view: HardwareView = {
    collected_at: report.collected_at,
    displays: (report.displays ?? []).map((display) => ({
      name: display.name,
      ...(display.resolution ? { resolution: display.resolution } : {}),
      ...(display.main ? { main: true } : {}),
    })),
    ...(report.from_cache ? { from_cache: true } : {}),
  }
  const text = (key: 'chip' | 'model' | 'model_id') => {
    const value = report[key]
    if (value) view[key] = value
  }
  text('chip')
  text('model')
  text('model_id')
  const num = (key: 'logical_cores' | 'performance_cores' | 'efficiency_cores' | 'gpu_cores' | 'memory_bytes') => {
    const value = report[key]
    if (value !== undefined) view[key] = value
  }
  num('logical_cores')
  num('performance_cores')
  num('efficiency_cores')
  num('gpu_cores')
  num('memory_bytes')
  if (report.battery) {
    view.battery = {
      ...(report.battery.health ? { health: report.battery.health } : {}),
      ...(report.battery.maximum_capacity_percent !== undefined
        ? { maximum_capacity_percent: report.battery.maximum_capacity_percent }
        : {}),
      ...(report.battery.cycle_count !== undefined ? { cycle_count: report.battery.cycle_count } : {}),
    }
  }
  if (report.cpu_features && report.cpu_features.length > 0) view.cpu_features = [...report.cpu_features]
  return view
}
