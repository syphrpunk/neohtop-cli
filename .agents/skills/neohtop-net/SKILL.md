---
name: neohtop-net
description: Per-connection byte rates attributed to a process. Does not sniff packets or escalate privileges. Run `neohtop net --help` for usage details.
requires_bin: neohtop
command: neohtop net
---

# neohtop net

Per-connection byte rates attributed to a process. Does not sniff packets or escalate privileges.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--sampleMs` | `number` | `500` | Window between the two counter reads, in ms |
| `--limit` | `number` | `20` | Max connections (0 = all). Idle connections are omitted |
