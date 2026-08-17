---
name: neohtop-metrics-db
description: Schema and query guide for the neohtop metrics SQLite store (~/.config/neohtop/neohtop.db) — system_samples + process_samples tables, plus when to prefer `neohtop history`/`neohtop report` over raw SQL.
---

# neohtop metrics DB

An hourly recorder (`neohtop service install` → launchd on macOS, systemd user timer on Linux) runs `neohtop record`, storing one system sample plus the top-N processes (by CPU) per run.

**Prefer the CLI over raw SQL** — it aggregates correctly and outputs any `--format`:

```bash
neohtop report --hours 24          # hourly avg/peak series, top consumers, anomaly flags, sparkline charts
neohtop history --hours 24 --charts    # raw per-sample series
neohtop history --processes        # include stored top processes per sample
neohtop config                     # paths + DB stats (sample count, first/last timestamps)
```

Anomaly flags in `report`: `io_pressure` (load1 > 2× cores at <60% CPU — I/O wait), `cpu_saturation` (>90% CPU), `memory_pressure` (>92% memory used).

## Storage

| Path | Purpose |
|---|---|
| `~/.config/neohtop/neohtop.db` | SQLite (WAL). `XDG_CONFIG_HOME` respected. |
| `~/.config/neohtop/config.json` | `record.processLimit` (default 30), `record.retentionDays` (30), `record.sampleMs` (500) |
| `~/.config/neohtop/record.log` | recorder stdout/stderr |

## Schema

```sql
CREATE TABLE system_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,                -- ISO 8601 UTC, e.g. 2026-08-17T03:16:19.605Z
  hostname TEXT NOT NULL,
  cpu_usage_total REAL NOT NULL,   -- percent, 0-100
  cpu_usage_per_core TEXT NOT NULL,-- JSON array of per-core percents
  memory_total INTEGER NOT NULL,   -- bytes
  memory_used INTEGER NOT NULL,
  memory_free INTEGER NOT NULL,
  load_1 REAL NOT NULL, load_5 REAL NOT NULL, load_15 REAL NOT NULL,
  network_rx_bytes INTEGER NOT NULL,  -- bytes/s at sample time
  network_tx_bytes INTEGER NOT NULL,
  disk_total_bytes INTEGER NOT NULL,
  disk_used_bytes INTEGER NOT NULL,
  disk_free_bytes INTEGER NOT NULL,
  uptime_secs INTEGER NOT NULL,
  process_count INTEGER NOT NULL
);

CREATE TABLE process_samples (      -- top-N by CPU per sample; FK cascades on prune
  sample_id INTEGER NOT NULL REFERENCES system_samples(id) ON DELETE CASCADE,
  pid INTEGER NOT NULL, ppid INTEGER NOT NULL,
  name TEXT NOT NULL,
  cpu_usage REAL NOT NULL,          -- percent of one core (can exceed 100 for multithreaded)
  memory_bytes INTEGER NOT NULL,    -- RSS
  status TEXT NOT NULL, user TEXT NOT NULL, command TEXT NOT NULL,
  threads INTEGER,                  -- nullable
  runtime_secs INTEGER NOT NULL,
  disk_read_bytes INTEGER NOT NULL, disk_write_bytes INTEGER NOT NULL
);
```

## Raw SQL recipes (when the CLI aggregates aren't enough)

```bash
DB=~/.config/neohtop/neohtop.db

# Hourly CPU/load profile
sqlite3 -column -header "$DB" "
  SELECT strftime('%Y-%m-%dT%H:00Z', at) hour, COUNT(*) n,
         ROUND(AVG(cpu_usage_total),1) cpu_avg, ROUND(MAX(cpu_usage_total),1) cpu_peak,
         ROUND(AVG(load_1),1) load_avg, ROUND(MAX(load_1),1) load_peak
  FROM system_samples GROUP BY hour ORDER BY hour"

# Top CPU consumers across all samples
sqlite3 -column -header "$DB" "
  SELECT p.name, COUNT(*) seen, ROUND(AVG(p.cpu_usage),1) cpu_avg,
         ROUND(MAX(p.cpu_usage),1) cpu_max,
         ROUND(AVG(p.memory_bytes)/1048576.0) mem_avg_mb
  FROM process_samples p GROUP BY p.name
  ORDER BY AVG(p.cpu_usage)*COUNT(*) DESC LIMIT 15"

# A process's trajectory over time
sqlite3 -column -header "$DB" "
  SELECT s.at, p.cpu_usage, p.memory_bytes/1048576 mem_mb
  FROM process_samples p JOIN system_samples s ON s.id = p.sample_id
  WHERE p.name LIKE '%Hermes%' ORDER BY s.at"
```

Gotchas: `at` is TEXT — string comparison works because it's ISO-8601 UTC. Retention pruning cascades `process_samples` deletes via FK, so a process absent from history may simply predate the retention window.
