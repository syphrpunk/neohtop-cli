---
name: neohtop-processes
description: List processes with regex filtering and column sorting. Run `neohtop processes --help` for usage details.
requires_bin: neohtop
command: neohtop processes
---

# neohtop processes

List processes with regex filtering and column sorting

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--filter` | `string` |  | Match name, command, and PID. Commas OR terms (chrome, node); quote a term to keep a comma in a regex. Predicates AND: cpu>, cpu>=, mem>, mem>= (K/M/G), pid:N |
| `--user` | `string` |  | Only processes owned by this user |
| `--sortBy` | `string` | `cpu` | Sort column |
| `--order` | `string` | `desc` | Sort direction |
| `--limit` | `number` | `0` | Max rows (0 = all) |
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
