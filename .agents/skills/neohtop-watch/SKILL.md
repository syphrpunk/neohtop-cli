---
name: neohtop-watch
description: Stream realtime snapshots at an interval (use --format jsonl for pipelines). Run `neohtop watch --help` for usage details.
requires_bin: neohtop
command: neohtop watch
---

# neohtop watch

Stream realtime snapshots at an interval (use --format jsonl for pipelines)

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--intervalMs` | `number` | `1000` | Refresh interval |
| `--count` | `number` | `0` | Number of snapshots to emit (0 = until interrupted) |
| `--filter` | `string` |  | Regex matched against name, command, and PID |
| `--sortBy` | `string` | `cpu` | Sort column |
| `--limit` | `number` | `15` | Processes per snapshot |
