#!/usr/bin/env bun
// neohtop — agent-friendly system monitor CLI (TypeScript port of cli/, built on incur).
// Every command supports --format toon|json|yaml|md|jsonl, --llms, and MCP via incur.

import { Cli, z } from 'incur'
import pkg from '../package.json' with { type: 'json' }
import { SORT_KEYS, filterProcesses, sortProcesses } from './filter/index.ts'
import { Monitor, sleep, snapshot } from './monitor/index.ts'

const listOptions = z.object({
  filter: z.string().optional().describe('Regex matched against name, command, and PID'),
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

Cli.create('neohtop', {
  description:
    'System monitor for humans and agents — realtime process/CPU/memory/disk/network reporting',
  version: pkg.version,
})
  .command('system', {
    description: 'System-wide stats: CPU, memory, disk, network, load, host info',
    options: z.object({ sampleMs: listOptions.shape.sampleMs }),
    async run(c) {
      const { system } = await snapshot(c.options.sampleMs)
      return c.ok(system, {
        cta: {
          commands: [
            { command: 'top', description: 'Top processes by CPU' },
            { command: 'watch', description: 'Stream realtime snapshots' },
          ],
        },
      })
    },
  })
  .command('processes', {
    description: 'List processes with regex filtering and column sorting',
    options: listOptions,
    async run(c) {
      const { processes } = await snapshot(c.options.sampleMs)
      const rows = selectProcesses(processes, c.options)
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
    description: 'Top N processes by CPU or memory',
    options: z.object({
      by: z.enum(['cpu', 'memory']).default('cpu').describe('Ranking column'),
      count: z.coerce.number().int().min(1).default(10).describe('Number of rows'),
      sampleMs: listOptions.shape.sampleMs,
    }),
    async run(c) {
      const { system, processes } = await snapshot(c.options.sampleMs)
      const rows = sortProcesses(processes, c.options.by, 'desc').slice(0, c.options.count)
      return {
        cpu_usage_total: system.cpu_usage_total,
        memory_used: system.memory_used,
        memory_total: system.memory_total,
        processes: rows.map((p) => ({
          pid: p.pid,
          name: p.name,
          cpu_usage: p.cpu_usage,
          memory_bytes: p.memory_bytes,
          user: p.user,
        })),
      }
    },
  })
  .command('proc', {
    description: 'Detailed info for a single process',
    args: z.object({ pid: z.coerce.number().int().positive().describe('Process ID') }),
    async run(c) {
      const { processes } = await snapshot(500)
      const proc = processes.find((p) => p.pid === c.args.pid)
      if (!proc)
        return c.error({ code: 'NOT_FOUND', message: `no process with pid ${c.args.pid}` })
      const children = processes.filter((p) => p.ppid === proc.pid).map((p) => p.pid)
      const parent = processes.find((p) => p.pid === proc.ppid)
      return c.ok(
        { ...proc, ...(parent ? { parent_name: parent.name } : {}), children },
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
