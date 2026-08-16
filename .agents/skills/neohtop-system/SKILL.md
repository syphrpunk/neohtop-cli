---
name: neohtop-system
description: "System-wide stats: CPU, memory, disk, network, load, host info. Run `neohtop system --help` for usage details."
requires_bin: neohtop
command: neohtop system
---

# neohtop system

System-wide stats: CPU, memory, disk, network, load, host info

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
