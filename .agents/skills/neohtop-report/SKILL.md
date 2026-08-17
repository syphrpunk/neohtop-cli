---
name: neohtop-report
description: "Aggregate report over the metrics store: hourly avg/peak series, top consumers, anomaly flags. Run `neohtop report --help` for usage details."
requires_bin: neohtop
command: neohtop report
---

# neohtop report

Aggregate report over the metrics store: hourly avg/peak series, top consumers, anomaly flags

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--hours` | `number` | `24` | Look-back window in hours |
| `--top` | `number` | `10` | Top consumers to include |
| `--charts` | `boolean` | `true` | Include braille sparkline trend charts (oldest → newest hour) |
