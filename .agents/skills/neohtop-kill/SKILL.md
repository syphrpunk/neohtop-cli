---
name: neohtop-kill
description: Send a signal to a process. Run `neohtop kill --help` for usage details.
requires_bin: neohtop
command: neohtop kill
---

# neohtop kill

Send a signal to a process

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pid` | `number` | yes | Process ID |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--signal` | `string` | `TERM` | Signal name |
