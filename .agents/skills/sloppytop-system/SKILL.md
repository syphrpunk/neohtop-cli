---
name: sloppytop-system
description: "System-wide stats: CPU, memory, disk, per-device throughput and latency, network, load, host info. On macOS, GPU utilization and in-use GPU memory are included when AGX PerformanceStatistics is present. Run `sloppytop system --help` for usage details."
requires_bin: sloppytop
command: sloppytop system
---

# sloppytop system

System-wide stats: CPU, memory, disk, per-device throughput and latency, network, load, host info. On macOS, GPU utilization and in-use GPU memory are included when AGX PerformanceStatistics is present.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
