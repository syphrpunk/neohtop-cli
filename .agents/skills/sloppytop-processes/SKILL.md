---
name: sloppytop-processes
description: List processes with regex filtering and column sorting. On macOS, gpu_time_ms is GPU time accrued during the sample window when an AGX client was present, and phys_footprint_bytes is the physical footprint when the rusage read succeeds. On Linux, cgroup is the cgroup2 path. Run `sloppytop processes --help` for usage details.
requires_bin: sloppytop
command: sloppytop processes
---

# sloppytop processes

List processes with regex filtering and column sorting. On macOS, gpu_time_ms is GPU time accrued during the sample window when an AGX client was present, and phys_footprint_bytes is the physical footprint when the rusage read succeeds. On Linux, cgroup is the cgroup2 path.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--filter` | `string` |  | Match name, command, and PID. Commas OR terms (chrome, node); quote a term to keep a comma in a regex. Predicates AND: cpu>, cpu>=, mem>, mem>= (K/M/G), pid:N |
| `--user` | `string` |  | Only processes owned by this user |
| `--sortBy` | `string` | `cpu` | Sort column |
| `--order` | `string` | `desc` | Sort direction |
| `--limit` | `number` | `0` | Max rows (0 = all) |
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
| `--pin` | `string` |  | Comma-separated name or command patterns to float for this run. Saved pins live in config.json |
