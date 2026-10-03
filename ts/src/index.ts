#!/usr/bin/env bun
// neohtop — agent-friendly system monitor CLI (TypeScript port of cli/, built on incur).
// Every command supports --format toon|json|yaml|md|jsonl, --llms, and MCP via incur.

import { Binary, Cli, z } from 'incur'
import pkg from '../package.json' with { type: 'json' }
import { SORT_KEYS, FilterQueryError, filterProcesses, sortProcesses } from './filter/index.ts'
import { splitPinned } from './filter/pins.ts'
import { buildProcessTree } from './filter/tree.ts'
import { HardwareError, hardwareInventory } from './monitor/hardware.ts'
import { Monitor, processDetail, sleep, snapshot } from './monitor/index.ts'
import { NetError, sampleNet } from './monitor/net.ts'
import { configDir, configPath, dbPath, initConfig, loadConfig, logPath } from './store/config.ts'
import { dbInfo, insertSample, openDb, queryHistory, queryTopProcesses } from './store/db.ts'
import { renderOpenMetrics } from './store/openmetrics.ts'
import {
  reportAnomalies,
  reportGroups,
  reportHourly,
  reportLeaks,
  reportTopConsumers,
  reportWindow,
} from './store/report.ts'
import * as service from './store/service.ts'
import { sparkline } from './view/sparkline.ts'

const listOptions = z.object({
  filter: z
    .string()
    .optional()
    .describe(
      'Match name, command, and PID. Commas OR terms (chrome, node); quote a term to keep a comma in a regex. Predicates AND: cpu>, cpu>=, mem>, mem>= (K/M/G), pid:N',
    ),
  user: z.string().optional().describe('Only processes owned by this user'),
  sortBy: z.enum(SORT_KEYS).default('cpu').describe('Sort column'),
  order: z.enum(['asc', 'desc']).default('desc').describe('Sort direction'),
  limit: z.coerce.number().int().min(0).default(0).describe('Max rows (0 = all)'),
  sampleMs: z.coerce
    .number()
    .int()
    .min(0)
    .default(500)
    .describe('Delta-sampling window in ms for CPU/network rates'),
})

type ListOptions = z.infer<typeof listOptions>

function selectProcesses(procs: Awaited<ReturnType<typeof snapshot>>['processes'], o: ListOptions) {
  const filtered = sortProcesses(filterProcesses(procs, o.filter, o.user), o.sortBy, o.order)
  return o.limit > 0 ? filtered.slice(0, o.limit) : filtered
}

function resolvePins(extra?: string): string[] {
  const once = extra?.split(',').map((pin) => pin.trim()).filter(Boolean) ?? []
  return [...loadConfig().pins, ...once]
}

function arrangePins<T extends { name: string; command: string }>(
  sorted: T[],
  patterns: string[],
  limit: number,
): Array<T | { pin: string; running: false }> {
  if (patterns.length === 0) return limit > 0 ? sorted.slice(0, limit) : sorted
  const { pinned, rest, missing } = splitPinned(sorted, patterns)
  const body = limit > 0 ? rest.slice(0, limit) : rest
  return [
    ...pinned.map((row) => ({ ...row, pinned: true as const })),
    ...body,
    ...missing.map((pin) => ({ pin, running: false as const })),
  ]
}

function badFilter(err: unknown): { code: 'BAD_FILTER'; message: string } | null {
  if (err instanceof FilterQueryError) return { code: 'BAD_FILTER', message: err.message }
  return null
}

Cli.create('neohtop', {
  description:
    'System monitor for humans and agents — realtime process/CPU/memory/disk/network reporting',
  version: pkg.version,
  // Self-update for compiled binaries via GitHub release assets
  // (neohtop-<target>.gz); a no-op when running from source.
  update: Binary.github({ repository: 'syphrpunk/neohtop-cli' }),
})
  .command('hardware', {
    description:
      'On-demand hardware inventory: chip, core layout, memory, displays, battery health. Cached under ~/.config/neohtop. record and service never call this.',
    options: z.object({
      refresh: z.boolean().default(false).describe('Re-read the platform and replace the cache'),
    }),
    run(c) {
      try {
        return c.ok(hardwareInventory({ refresh: c.options.refresh }))
      } catch (err) {
        if (err instanceof HardwareError) {
          return c.error({ code: 'HARDWARE_UNAVAILABLE', message: err.message })
        }
        throw err
      }
    },
  })
  .command('system', {
    description:
      'System-wide stats: CPU, memory, disk, per-device throughput and latency, network, load, host info',
    options: z.object({ sampleMs: listOptions.shape.sampleMs }),
    async run(c) {
      const { system } = await snapshot(c.options.sampleMs)
      return c.ok(system, {
        cta: {
          commands: [
            { command: 'top', description: 'Top processes by CPU' },
            { command: 'net', description: 'Per-connection byte rates' },
            { command: 'watch', description: 'Stream realtime snapshots' },
          ],
        },
      })
    },
  })
  .command('net', {
    description:
      'Per-connection byte rates attributed to a process. Does not sniff packets or escalate privileges.',
    options: z.object({
      sampleMs: z.coerce
        .number()
        .int()
        .min(100)
        .default(500)
        .describe('Window between the two counter reads, in ms'),
      limit: z.coerce
        .number()
        .int()
        .min(0)
        .default(20)
        .describe('Max connections (0 = all). Idle connections are omitted'),
    }),
    async run(c) {
      try {
        const rows = await sampleNet(c.options.sampleMs)
        const shown = c.options.limit > 0 ? rows.slice(0, c.options.limit) : rows
        return c.ok(
          { count: shown.length, sample_ms: c.options.sampleMs, connections: shown },
          {
            cta: {
              commands: [{ command: 'proc <pid>', description: 'Inspect one of these processes' }],
            },
          },
        )
      } catch (err) {
        if (err instanceof NetError) return c.error({ code: 'NET_UNAVAILABLE', message: err.message })
        throw err
      }
    },
  })
  .command('processes', {
    description:
      'List processes with regex filtering and column sorting. On macOS, gpu_time_ms is GPU time accrued during the sample window when an AGX client was present. On Linux, cgroup is the cgroup2 path.',
    options: listOptions.extend({
      pin: z
        .string()
        .optional()
        .describe(
          'Comma-separated name or command patterns to float for this run. Saved pins live in config.json',
        ),
    }),
    async run(c) {
      const { processes } = await snapshot(c.options.sampleMs)
      let rows
      try {
        const sorted = sortProcesses(
          filterProcesses(processes, c.options.filter, c.options.user),
          c.options.sortBy,
          c.options.order,
        )
        rows = arrangePins(sorted, resolvePins(c.options.pin), c.options.limit)
      } catch (err) {
        const bad = badFilter(err)
        if (bad) return c.error(bad)
        throw err
      }
      return c.ok(
        { count: rows.length, total: processes.length, processes: rows },
        {
          cta: {
            commands: [
              { command: 'proc <pid>', description: 'Inspect one process' },
              { command: 'kill <pid>', description: 'Send a signal to a process' },
            ],
          },
        },
      )
    },
  })
  .command('top', {
    description:
      'Top N processes by CPU or memory. On macOS, rows include gpu_time_ms when an AGX client accrued time during the sample window.',
    options: z.object({
      by: z.enum(['cpu', 'memory']).default('cpu').describe('Ranking column'),
      count: z.coerce
        .number()
        .int()
        .min(1)
        .default(10)
        .describe('Unpinned rows to keep. Pinned rows are extra and stay visible'),
      pin: z
        .string()
        .optional()
        .describe(
          'Comma-separated name or command patterns to float for this run. Saved pins live in config.json',
        ),
      sampleMs: listOptions.shape.sampleMs,
    }),
    async run(c) {
      const { system, processes } = await snapshot(c.options.sampleMs)
      const sorted = sortProcesses(processes, c.options.by, 'desc')
      const rows = arrangePins(sorted, resolvePins(c.options.pin), c.options.count)
      return {
        cpu_usage_total: system.cpu_usage_total,
        memory_used: system.memory_used,
        memory_total: system.memory_total,
        processes: rows.map((p) =>
          'running' in p
            ? p
            : {
                pid: p.pid,
                name: p.name,
                cpu_usage: p.cpu_usage,
                memory_bytes: p.memory_bytes,
                user: p.user,
                ...('pinned' in p ? { pinned: true } : {}),
              },
        ),
      }
    },
  })
  .command('tree', {
    description: 'Process tree (depth-first, PPID→PID) with rendering prefixes',
    options: z.object({
      filter: listOptions.shape.filter,
      user: listOptions.shape.user,
      sampleMs: listOptions.shape.sampleMs,
    }),
    async run(c) {
      const { processes } = await snapshot(c.options.sampleMs)
      let matched
      try {
        matched = filterProcesses(processes, c.options.filter, c.options.user)
      } catch (err) {
        const bad = badFilter(err)
        if (bad) return c.error(bad)
        throw err
      }
      const rows = buildProcessTree(matched)
      return {
        count: rows.length,
        processes: rows.map((p) => ({
          pid: p.pid,
          ppid: p.ppid,
          depth: p.tree_depth,
          name: `${p.tree_prefix}${p.name}`,
          cpu_usage: p.cpu_usage,
          memory_bytes: p.memory_bytes,
          user: p.user,
        })),
      }
    },
  })
  .command('proc', {
    description: 'Detailed info for a single process (cwd, children; --env for environment)',
    args: z.object({ pid: z.coerce.number().int().positive().describe('Process ID') }),
    options: z.object({
      env: z
        .boolean()
        .default(false)
        .describe('Include environment variables (same-user processes only without root)'),
    }),
    async run(c) {
      const { processes } = await snapshot(500)
      const proc = processes.find((p) => p.pid === c.args.pid)
      if (!proc)
        return c.error({ code: 'NOT_FOUND', message: `no process with pid ${c.args.pid}` })
      const children = processes.filter((p) => p.ppid === proc.pid).map((p) => p.pid)
      const parent = processes.find((p) => p.pid === proc.ppid)
      const detail = await processDetail(proc.pid)
      return c.ok(
        {
          ...proc,
          ...(parent ? { parent_name: parent.name } : {}),
          ...(detail.cwd ? { cwd: detail.cwd } : {}),
          ...(c.options.env ? { environ: detail.environ ?? [] } : {}),
          children,
        },
        {
          cta: {
            commands: [{ command: `kill ${proc.pid}`, description: 'Send SIGTERM' }],
          },
        },
      )
    },
  })
  .command('snapshot', {
    description: 'Full snapshot (system + all processes) — same shape as the Go CLI --json',
    options: z.object({ sampleMs: listOptions.shape.sampleMs }),
    async run(c) {
      const { system, processes } = await snapshot(c.options.sampleMs)
      return { version: pkg.version, system, processes }
    },
  })
  .command('watch', {
    description: 'Stream realtime snapshots at an interval (use --format jsonl for pipelines)',
    options: z.object({
      intervalMs: z.coerce.number().int().min(100).default(1000).describe('Refresh interval'),
      count: z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .describe('Number of snapshots to emit (0 = until interrupted)'),
      filter: listOptions.shape.filter,
      sortBy: listOptions.shape.sortBy,
      limit: z.coerce.number().int().min(1).default(15).describe('Processes per snapshot'),
    }),
    async *run(c) {
      try {
        filterProcesses([], c.options.filter)
      } catch (err) {
        const bad = badFilter(err)
        if (bad) return c.error(bad)
        throw err
      }
      const mon = await Monitor.create()
      mon.refresh()
      for (let seq = 1; c.options.count === 0 || seq <= c.options.count; seq++) {
        await sleep(c.options.intervalMs)
        mon.refresh()
        const rows = sortProcesses(
          filterProcesses(mon.processes(), c.options.filter),
          c.options.sortBy,
          'desc',
        ).slice(0, c.options.limit)
        yield { seq, at: new Date().toISOString(), system: mon.stats(), processes: rows }
      }
    },
  })
  .command('record', {
    description: 'Take a snapshot and store it in the metrics SQLite DB (~/.config/neohtop)',
    async run(c) {
      const config = initConfig()
      const { system, processes } = await snapshot(config.record.sampleMs)
      const db = openDb()
      try {
        const at = new Date().toISOString()
        const result = insertSample(db, at, system, processes, config.record)
        return c.ok(
          {
            recorded: true,
            sample_id: result.sampleId,
            at,
            processes_stored: result.processesStored,
            pruned: result.pruned,
            db_path: dbPath(),
          },
          {
            cta: {
              commands: [{ command: 'history', description: 'Query recorded samples' }],
            },
          },
        )
      } finally {
        db.close()
      }
    },
  })
  .command('history', {
    description: 'Query recorded metrics from the SQLite store',
    options: z.object({
      hours: z.coerce.number().min(0.1).default(24).describe('Look-back window in hours'),
      limit: z.coerce.number().int().min(1).default(200).describe('Max samples returned'),
      processes: z
        .boolean()
        .default(false)
        .describe('Include stored top processes for each sample'),
      charts: z
        .boolean()
        .default(false)
        .describe('Include braille sparkline trend charts (oldest → newest)'),
      openmetrics: z
        .boolean()
        .default(false)
        .describe(
          'Print the latest sample as OpenMetrics text. Default format prints it raw; json wraps the string',
        ),
    }),
    run(c) {
      const db = openDb()
      try {
        const since = new Date(Date.now() - c.options.hours * 3_600_000).toISOString()
        const rows = queryHistory(db, since, c.options.openmetrics ? 1 : c.options.limit)
        if (c.options.openmetrics) {
          const latest = rows[0]
          if (!latest)
            return c.error({
              code: 'NO_DATA',
              message: `no samples in the last ${c.options.hours}h — run 'record' once or 'service install' for hourly recording`,
            })
          return renderOpenMetrics(latest)
        }
        const samples = c.options.processes
          ? rows.map((r) => ({ ...r, top_processes: queryTopProcesses(db, r.id) }))
          : rows
        const chrono = [...rows].reverse() // queryHistory returns newest-first
        const charts = c.options.charts
          ? {
              cpu_pct: sparkline(
                chrono.map((r) => r.cpu_usage_total),
                { max: 100 },
              ),
              memory_used: sparkline(chrono.map((r) => r.memory_used)),
              load_1: sparkline(chrono.map((r) => r.load_1)),
            }
          : undefined
        return {
          ...dbInfo(db),
          window_hours: c.options.hours,
          returned: rows.length,
          ...(charts ? { charts } : {}),
          samples,
        }
      } finally {
        db.close()
      }
    },
  })
  .command('report', {
    description:
      'Aggregate report over the metrics store: hourly avg/peak series, top consumers, anomaly flags, RSS leak flags, and configured process groups',
    options: z.object({
      hours: z.coerce.number().min(1).default(24).describe('Look-back window in hours'),
      top: z.coerce.number().int().min(1).default(10).describe('Top consumers to include'),
      charts: z
        .boolean()
        .default(true)
        .describe('Include braille sparkline trend charts (oldest → newest hour)'),
    }),
    run(c) {
      const db = openDb()
      try {
        const since = new Date(Date.now() - c.options.hours * 3_600_000).toISOString()
        const window = reportWindow(db, since)
        if (!window)
          return c.error({
            code: 'NO_DATA',
            message: `no samples in the last ${c.options.hours}h — run 'record' once or 'service install' for hourly recording`,
          })
        window.hours = c.options.hours
        const hourly = reportHourly(db, since)
        const topConsumers = reportTopConsumers(db, since, c.options.top)
        const anomalies = reportAnomalies(db, since)
        const leaks = reportLeaks(db, since)
        const groups = reportGroups(db, since, loadConfig().groups)

        const n = hourly.reduce((a, h) => a + h.samples, 0)
        const wavg = (f: (h: (typeof hourly)[number]) => number) =>
          Math.round((hourly.reduce((a, h) => a + f(h) * h.samples, 0) / n) * 10) / 10
        const summary = {
          cpu_avg: wavg((h) => h.cpu_avg),
          cpu_peak: Math.max(...hourly.map((h) => h.cpu_peak)),
          memory_used_avg: Math.round(hourly.reduce((a, h) => a + h.memory_used_avg * h.samples, 0) / n),
          memory_used_peak: Math.max(...hourly.map((h) => h.memory_used_peak)),
          load1_avg: wavg((h) => h.load1_avg),
          load1_peak: Math.max(...hourly.map((h) => h.load1_peak)),
          anomaly_count: anomalies.length,
        }
        const charts = c.options.charts
          ? {
              cpu_pct: sparkline(
                hourly.map((h) => h.cpu_avg),
                { max: 100 },
              ),
              memory_used: sparkline(hourly.map((h) => h.memory_used_avg)),
              load_1: sparkline(hourly.map((h) => h.load1_avg)),
            }
          : undefined
        return c.ok(
          {
            window,
            summary,
            ...(charts ? { charts } : {}),
            hourly,
            top_consumers: topConsumers,
            anomalies,
            leaks,
            groups,
          },
          {
            cta: {
              commands: [
                { command: 'history --charts', description: 'Per-sample series' },
                { command: 'top', description: 'Live top processes' },
              ],
            },
          },
        )
      } finally {
        db.close()
      }
    },
  })
  .command('config', {
    description: 'Show effective config and storage paths (~/.config/neohtop)',
    run() {
      const db = openDb()
      const info = dbInfo(db)
      db.close()
      return {
        config: initConfig(),
        paths: { dir: configDir(), config: configPath(), db: dbPath(), log: logPath() },
        db: info,
      }
    },
  })
  .command(
    Cli.create('service', {
      description:
        'Manage the hourly metrics recorder (launchd agent on macOS, systemd user timer on Linux)',
    })
      .command('install', {
        description: 'Install + start a scheduled job that runs `record` on an interval',
        options: z.object({
          intervalSecs: z.coerce
            .number()
            .int()
            .min(60)
            .default(3600)
            .describe('Seconds between record runs (default hourly)'),
        }),
        run(c) {
          try {
            const result = service.install(c.options.intervalSecs)
            return c.ok(
              {
                installed: true,
                scheduler: result.scheduler,
                name: service.scheduler().name,
                files: result.files,
                command: result.command.join(' '),
                interval_secs: c.options.intervalSecs,
                log: logPath(),
              },
              {
                cta: {
                  commands: [{ command: 'service status', description: 'Verify the job' }],
                },
              },
            )
          } catch (err) {
            return c.error({ code: 'INSTALL_FAILED', message: (err as Error).message })
          }
        },
      })
      .command('uninstall', {
        description: 'Stop and remove the scheduled recorder job',
        run(c) {
          try {
            return { ...service.uninstall(), name: service.scheduler().name }
          } catch (err) {
            return c.error({ code: 'UNINSTALL_FAILED', message: (err as Error).message })
          }
        },
      })
      .command('status', {
        description: 'Show scheduled-job state and DB stats',
        run(c) {
          try {
            const db = openDb()
            const info = dbInfo(db)
            db.close()
            return {
              ...service.status(),
              name: service.scheduler().name,
              db: info,
              db_path: dbPath(),
            }
          } catch (err) {
            return c.error({ code: 'STATUS_FAILED', message: (err as Error).message })
          }
        },
      }),
  )
  .command('kill', {
    description: 'Send a signal to a process',
    args: z.object({ pid: z.coerce.number().int().positive().describe('Process ID') }),
    options: z.object({
      signal: z
        .enum(['TERM', 'KILL', 'INT', 'HUP', 'STOP', 'CONT', 'USR1', 'USR2'])
        .default('TERM')
        .describe('Signal name'),
    }),
    run(c) {
      const signal = `SIG${c.options.signal}` as NodeJS.Signals
      try {
        process.kill(c.args.pid, signal)
        return { killed: true, pid: c.args.pid, signal }
      } catch (err) {
        return c.error({
          code: 'SIGNAL_FAILED',
          message: `failed to signal pid ${c.args.pid}: ${(err as Error).message}`,
        })
      }
    },
  })
  .serve()
