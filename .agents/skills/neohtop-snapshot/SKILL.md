---
name: neohtop-snapshot
description: Full snapshot (system + all processes) — same shape as the Go CLI --json. Run `neohtop snapshot --help` for usage details.
requires_bin: neohtop
command: neohtop snapshot
---

# neohtop snapshot

Full snapshot (system + all processes) — same shape as the Go CLI --json

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
