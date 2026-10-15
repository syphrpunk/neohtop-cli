---
name: sloppytop-watch
description: Stream realtime snapshots at an interval (use --format jsonl for pipelines). Run `sloppytop watch --help` for usage details.
requires_bin: sloppytop
command: sloppytop watch
---

# sloppytop watch

Stream realtime snapshots at an interval (use --format jsonl for pipelines)

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--intervalMs` | `number` | `1000` | Refresh interval |
| `--count` | `number` | `0` | Number of snapshots to emit (0 = until interrupted) |
| `--filter` | `string` |  | Match name, command, and PID. Commas OR terms (chrome, node); quote a term to keep a comma in a regex. Predicates AND: cpu>, cpu>=, mem>, mem>= (K/M/G), pid:N |
| `--sortBy` | `string` | `cpu` | Sort column |
| `--limit` | `number` | `15` | Processes per snapshot |
