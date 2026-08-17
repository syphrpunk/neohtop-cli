# neohtop (TypeScript port)

TypeScript port of the Go CLI in `../cli/`, built on [incur](https://github.com/wevm/incur) — wevm's agent-first CLI framework. The original [NeoHtop](https://github.com/Abdenasser/NeoHtop) and neohtop-cli are by [Abdenasser](https://github.com/Abdenasser) (MIT); this port keeps that license and attribution. Designed to serve double duty:

- **Data & reporting tool** — every command outputs TOON (token-efficient default), JSON, YAML, Markdown, or JSONL via `--format`.
- **Agentic tool** — agents discover the CLI via `neohtop skills add` / `neohtop mcp add` / `--llms`, get schema-validated inputs, and receive call-to-action suggestions after each run.

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

State lives under `~/.config/neohtop/` (argo-style; `XDG_CONFIG_HOME` respected):

| File | Purpose |
|---|---|
| `config.json` | persisted settings (`record.processLimit`, `record.retentionDays`, `record.sampleMs`) |
| `neohtop.db` | SQLite metrics store (`bun:sqlite`, WAL) — one `system_samples` row + top-N `process_samples` per record run |
| `record.log` | stdout/stderr of the launchd job |

```bash
neohtop record                    # take one sample into the DB (also prunes past retention)
neohtop history --hours 24        # system series from the store
neohtop history --charts          # + braille sparkline trend charts
neohtop history --processes       # include stored top processes per sample
neohtop report --hours 24         # hourly avg/peak series, top consumers, anomaly flags, charts
neohtop config                    # effective config + storage paths + DB stats
neohtop service install           # scheduled job: runs `record` hourly
neohtop service status            # job state + DB stats
neohtop service uninstall
```

`report` flags unhealthy samples: `io_pressure` (load1 far above core count at moderate CPU — I/O wait), `cpu_saturation` (>90% CPU), `memory_pressure` (>92% used).

`service install` uses the platform scheduler with absolute paths (neither inherits a useful PATH) — pointing at the compiled binary when installed from one, or `<bun> <script> record` in dev:

- **macOS**: launchd user agent at `~/Library/LaunchAgents/com.syphrpunk.neohtop.record.plist` (RunAtLoad fires one sample immediately)
- **Linux**: systemd user units `neohtop-record.service` + `.timer` under `~/.config/systemd/user/` (`OnUnitActiveSec`, enabled via `systemctl --user enable --now`)

## Self-update

Compiled release binaries embed incur's update metadata: `neohtop --update` checks GitHub releases for a newer `neohtop-<target>.gz` asset, verifies its SHA-256 digest, and swaps the executable in place. Running from source is unaffected.

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
| Config persistence | ✅ `~/.config/neohtop/config.json` (+ SQLite metrics store and scheduled recorder — beyond Go parity) |
| Reporting | ✅ `report` (hourly aggregates, top consumers, anomaly flags) + braille sparkline charts (port of `cli/view/sparkline.go`) |
| Self-update | ✅ `--update` via incur's GitHub-release provider (compiled binaries only) |
| Sparklines | ✅ `ts/src/view/sparkline.ts` — same 5-level braille mapping as the Go TUI |
| TUI | ⬜ planned via [OpenTUI](https://github.com/sst/opentui) (low priority) |

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
│   ├── config.ts     # ~/.config/neohtop paths + persisted settings
│   ├── db.ts         # bun:sqlite metrics store (system_samples, process_samples)
│   ├── report.ts     # aggregate queries: hourly series, top consumers, anomalies
│   └── service.ts    # scheduled recorder (launchd / systemd user timer)
├── view/
│   └── sparkline.ts  # braille sparklines (port of cli/view/sparkline.go)
└── filter/           # regex filter + column sort + process tree port
```
