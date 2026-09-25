---
name: neohtop-top
description: Top N processes by CPU or memory. Run `neohtop top --help` for usage details.
requires_bin: neohtop
command: neohtop top
---

# neohtop top

Top N processes by CPU or memory

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--by` | `string` | `cpu` | Ranking column |
| `--count` | `number` | `10` | Unpinned rows to keep. Pinned rows are extra and stay visible |
| `--pin` | `string` |  | Comma-separated name or command patterns to float for this run. Saved pins live in config.json |
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
