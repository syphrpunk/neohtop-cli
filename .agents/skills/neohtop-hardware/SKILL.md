---
name: neohtop-hardware
description: "On-demand hardware inventory: chip, core layout, memory, displays, battery health. Cached under ~/.config/neohtop. record and service never call this. Run `neohtop hardware --help` for usage details."
requires_bin: neohtop
command: neohtop hardware
---

# neohtop hardware

On-demand hardware inventory: chip, core layout, memory, displays, battery health. Cached under ~/.config/neohtop. record and service never call this.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--refresh` | `boolean` | `false` | Re-read the platform and replace the cache |
