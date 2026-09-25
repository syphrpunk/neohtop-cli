---
name: neohtop-tree
description: Process tree (depth-first, PPID→PID) with rendering prefixes. Run `neohtop tree --help` for usage details.
requires_bin: neohtop
command: neohtop tree
---

# neohtop tree

Process tree (depth-first, PPID→PID) with rendering prefixes

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--filter` | `string` |  | Match name, command, and PID. Commas OR terms (chrome, node); quote a term to keep a comma in a regex. Predicates AND: cpu>, cpu>=, mem>, mem>= (K/M/G), pid:N |
| `--user` | `string` |  | Only processes owned by this user |
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
