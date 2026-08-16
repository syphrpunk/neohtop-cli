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
| `--filter` | `string` |  | Match against name, command, and PID — bare words match whole words; regex metacharacters switch to full regex |
| `--user` | `string` |  | Only processes owned by this user |
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
