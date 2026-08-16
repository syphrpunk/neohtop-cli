---
name: neohtop-history
description: Query recorded metrics from the SQLite store. Run `neohtop history --help` for usage details.
requires_bin: neohtop
command: neohtop history
---

# neohtop history

Query recorded metrics from the SQLite store

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--hours` | `number` | `24` | Look-back window in hours |
| `--limit` | `number` | `200` | Max samples returned |
| `--processes` | `boolean` | `false` | Include stored top processes for each sample |
