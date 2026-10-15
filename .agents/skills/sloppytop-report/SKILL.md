---
name: sloppytop-report
description: "Aggregate report over the metrics store: hourly avg/peak series, top consumers, anomaly flags, RSS leak flags, and configured process groups. Run `sloppytop report --help` for usage details."
requires_bin: sloppytop
command: sloppytop report
---

# sloppytop report

Aggregate report over the metrics store: hourly avg/peak series, top consumers, anomaly flags, RSS leak flags, and configured process groups

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--hours` | `number` | `24` | Look-back window in hours |
| `--top` | `number` | `10` | Top consumers to include |
| `--charts` | `boolean` | `true` | Include braille sparkline trend charts (oldest → newest hour) |
