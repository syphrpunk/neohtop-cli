---
name: sloppytop-history
description: Query recorded metrics from the SQLite store. Run `sloppytop history --help` for usage details.
requires_bin: sloppytop
command: sloppytop history
---

# sloppytop history

Query recorded metrics from the SQLite store

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--hours` | `number` | `24` | Look-back window in hours |
| `--limit` | `number` | `200` | Max samples returned |
| `--processes` | `boolean` | `false` | Include stored top processes for each sample |
| `--charts` | `boolean` | `false` | Include braille sparkline trend charts (oldest → newest) |
| `--openmetrics` | `boolean` | `false` | Print the latest sample as OpenMetrics text. Default format prints it raw; json wraps the string |
