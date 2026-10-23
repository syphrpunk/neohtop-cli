# sloppytop (TypeScript port)

TypeScript port of the Go CLI in `../cli/`, built on [incur](https://github.com/wevm/incur) — wevm's agent-first CLI framework. The original [NeoHtop](https://github.com/Abdenasser/NeoHtop) is by [Abdenasser](https://github.com/Abdenasser) (MIT); this port keeps that license and attribution. Designed to serve double duty:

- **Data & reporting tool** — every command outputs TOON (token-efficient default), JSON, YAML, Markdown, or JSONL via `--format`.
- **Agentic tool** — agents discover the CLI via `sloppytop skills add` / `sloppytop mcp add` / `--llms`, get schema-validated inputs, and receive call-to-action suggestions after each run.

## Usage

```bash
just ts-setup                # bun install
just ts system               # system stats (CPU, memory, disk, network, load)
just ts processes --filter '^chrome' --sort-by memory --limit 10
just ts top --by cpu --count 5
just ts proc 1234            # single-process detail (+ parent/children)
just ts tree --filter safari # process tree with ├─/└─ prefixes
just ts snapshot --format json   # Go-CLI --json parity output
just ts watch --interval-ms 1000 --format jsonl   # realtime stream
just ts kill 1234 --signal TERM
```

Global flags from incur on every command: `--format toon|json|yaml|md|jsonl`, `--filter-output`, `--token-limit`, `--schema`, `--llms`, `--mcp`, `--full-output`.

## Persistence & hourly metrics recording

State lives under `~/.config/sloppytop/` (`XDG_CONFIG_HOME` respected). An existing `~/.config/neohtop/` directory is used when `~/.config/sloppytop/` is absent, and `neohtop.db` / `neohtop.log` in that directory are kept until the new filenames exist:

| File | Purpose |
|---|---|
| `config.json` | persisted settings (`record.processLimit`, `record.retentionDays`, `record.sampleMs`) |
| `sloppytop.db` | SQLite metrics store (`bun:sqlite`, WAL) — one `system_samples` row + top-N `process_samples` per record run |
| `record.log` | stdout/stderr of the launchd job |

```bash
sloppytop record                    # take one sample into the DB (also prunes past retention)
sloppytop history --hours 24        # system series from the store
sloppytop history --charts          # + braille sparkline trend charts
sloppytop history --processes       # include stored top processes per sample
sloppytop report --hours 24         # hourly avg/peak series, top consumers, anomaly flags, charts
sloppytop config                    # effective config + storage paths + DB stats
sloppytop service install           # scheduled job: runs `record` hourly
sloppytop service status            # job state + DB stats
sloppytop service uninstall
```

`report` flags unhealthy samples: `io_pressure` (load1 far above core count at moderate CPU — I/O wait), `cpu_saturation` (>90% CPU), `memory_pressure` (>92% used).

`service install` uses the platform scheduler with absolute paths (neither inherits a useful PATH) — pointing at the compiled binary when installed from one, or `<bun> <script> record` in dev:

- **macOS**: launchd user agent at `~/Library/LaunchAgents/com.syphrpunk.sloppytop.record.plist` (RunAtLoad fires one sample immediately)
- **Linux**: systemd user units `sloppytop-record.service` + `.timer` under `~/.config/systemd/user/` (`OnUnitActiveSec`, enabled via `systemctl --user enable --now`)

## Self-update

Compiled release binaries embed incur's update metadata: `sloppytop --update` checks releases of `syphrpunk/neohtop-cli` for a newer `sloppytop-<target>.gz` asset, verifies its SHA-256 digest, and swaps the executable in place. Running from source is unaffected. The GitHub repository name is unchanged.

## Port status

| Go feature | TS status |
|---|---|
| `--json` snapshot | ✅ `snapshot` (same field names — jq pipelines keep working) |
| System stats (`monitor/system_*.go`) | ✅ macOS (`ps`/`sysctl`/`vm_stat`/`netstat`/`df`), Linux (`/proc`) |
| Process list (`monitor/process_*.go`) | ✅ macOS + Linux |
| Regex search + sort (`filter/`) | ✅ `--filter`, `--sort-by`, `--order` |
| Realtime refresh loop | ✅ `watch` (streaming, JSONL-friendly) |
| Kill process | ✅ `kill` with signal choice |
| Process tree (`filter/tree.go`) | ✅ `tree` (DFS order + rendering prefixes, faithful port) |
| Per-core CPU on macOS | ✅ via `os.cpus()` tick deltas — bun canary surfaces real `host_processor_info` counters, no FFI needed |
| Agent wiring | ✅ `.agents/skills/` (symlinked into `.claude/`, `.augment/`) + `.mcp.json` (progressive-discovery MCP) |
| Per-process disk I/O | ✅ macOS `bun:ffi` → libproc `proc_pid_rusage`; Linux `/proc/[pid]/io` (same-user without root, like Go) |
| Threads + virtual memory on macOS | ✅ `bun:ffi` → `proc_pidinfo(PROC_PIDTASKINFO)` (verified against `ps -M`) |
| Process detail (`ProcessDetail`) | ✅ `proc` shows cwd (+ `--env` for environ via `KERN_PROCARGS2` / `/proc/[pid]/environ`) |
| All 10 sort columns | ✅ cpu, memory, pid, name, runtime, user, status, command, disk, threads |
| Standalone binary | ✅ `just ts-compile` (bun `--compile`, ~63 MB); releases attach per-platform binaries built natively in CI (canary can't cross-target) |
| Windows | ✅ monitor port (PowerShell CIM + `os.cpus()` ticks; no load avg / process owner / cwd) — CI-built, not yet hand-verified on hardware |
| Config persistence | ✅ `~/.config/sloppytop/config.json` (+ SQLite metrics store and scheduled recorder — beyond Go parity) |
| Reporting | ✅ `report` (hourly aggregates, top consumers, anomaly flags) + braille sparkline charts (port of `cli/view/sparkline.go`) |
| Self-update | ✅ `--update` via incur's GitHub-release provider (compiled binaries only) |
| Sparklines | ✅ `ts/src/view/sparkline.ts` — same 5-level braille mapping as the Go TUI |
| TUI | ✅ `sloppytop tui` on OpenTUI: each probe in its own labeled rows (bordered cpu, mem, disk, net, and the other probes that returned a reading, when the terminal is wide; one reading per row; per-core sparklines in cpu), ruled process table, footer, and theme colors, plus on-demand env, files, connections, listen, and hardware, history, report, the probe log, one-shot record, probe switches, and the metrics listener. The compiled release binary includes this screen. The release does not upload `sloppytop-cli`. `just build` still writes that binary locally. |

All low-level access uses native bun (`bun:ffi` `dlopen` on `libSystem.B.dylib`) — zero added dependencies beyond incur.

## Layout

```
ts/src/
├── index.ts          # incur CLI: system, processes, top, proc, snapshot, watch, kill,
│                     # record, history, report, config, service
├── monitor/
│   ├── types.ts      # output shapes (mirror Go --json keys) + platform contract
│   ├── index.ts      # Monitor class — delta/rate computation, snapshot()
│   ├── darwin.ts     # macOS collector (ps/sysctl/vm_stat + bun:ffi libproc)
│   ├── linux.ts      # Linux collector (/proc, direct port of Go approach)
│   └── windows.ts    # Windows collector (PowerShell CIM + os.cpus() ticks)
├── store/
│   ├── config.ts     # ~/.config/sloppytop paths + persisted settings
│   ├── db.ts         # bun:sqlite metrics store (system_samples, process_samples)
│   ├── report.ts     # aggregate queries: hourly series, top consumers, anomalies
│   └── service.ts    # scheduled recorder (launchd / systemd user timer)
├── view/
│   └── sparkline.ts  # braille sparklines (port of cli/view/sparkline.go)
└── filter/           # regex filter + column sort + process tree port
```
