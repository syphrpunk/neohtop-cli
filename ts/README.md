# neohtop (TypeScript port)

TypeScript port of the Go CLI in `../cli/`, built on [incur](https://github.com/wevm/incur) — wevm's agent-first CLI framework. Designed to serve double duty:

- **Data & reporting tool** — every command outputs TOON (token-efficient default), JSON, YAML, Markdown, or JSONL via `--format`.
- **Agentic tool** — agents discover the CLI via `neohtop skills add` / `neohtop mcp add` / `--llms`, get schema-validated inputs, and receive call-to-action suggestions after each run.

## Usage

```bash
just ts-setup                # bun install
just ts system               # system stats (CPU, memory, disk, network, load)
just ts processes --filter '^chrome' --sort-by memory --limit 10
just ts top --by cpu --count 5
just ts proc 1234            # single-process detail (+ parent/children)
just ts snapshot --format json   # Go-CLI --json parity output
just ts watch --interval-ms 1000 --format jsonl   # realtime stream
just ts kill 1234 --signal TERM
```

Global flags from incur on every command: `--format toon|json|yaml|md|jsonl`, `--filter-output`, `--token-limit`, `--schema`, `--llms`, `--mcp`, `--full-output`.

## Port status

| Go feature | TS status |
|---|---|
| `--json` snapshot | ✅ `snapshot` (same field names — jq pipelines keep working) |
| System stats (`monitor/system_*.go`) | ✅ macOS (`ps`/`sysctl`/`vm_stat`/`netstat`/`df`), Linux (`/proc`) |
| Process list (`monitor/process_*.go`) | ✅ macOS + Linux |
| Regex search + sort (`filter/`) | ✅ `--filter`, `--sort-by`, `--order` |
| Realtime refresh loop | ✅ `watch` (streaming, JSONL-friendly) |
| Kill process | ✅ `kill` with signal choice |
| Process tree (`filter/tree.go`) | ⬜ planned (`proc` shows parent/children for now) |
| Per-core CPU on macOS | ⬜ needs mach `host_processor_info` (bun FFI) — total CPU provided |
| Per-process disk I/O | ⬜ reported as 0 (needs privileged APIs) |
| Windows | ⬜ planned |
| TUI | ⬜ planned via [OpenTUI](https://github.com/sst/opentui) (low priority) |

## Layout

```
ts/src/
├── index.ts          # incur CLI: system, processes, top, proc, snapshot, watch, kill
├── monitor/
│   ├── types.ts      # output shapes (mirror Go --json keys) + platform contract
│   ├── index.ts      # Monitor class — delta/rate computation, snapshot()
│   ├── darwin.ts     # macOS collector (shell interfaces instead of CGo)
│   └── linux.ts      # Linux collector (/proc, direct port of Go approach)
└── filter/           # regex filter + column sort port
```
