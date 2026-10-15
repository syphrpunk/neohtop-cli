---
name: sloppytop-kill
description: Send a signal to a process. Run `sloppytop kill --help` for usage details.
requires_bin: sloppytop
command: sloppytop kill
---

# sloppytop kill

Send a signal to a process

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pid` | `number` | yes | Process ID |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--signal` | `string` | `TERM` | Signal name |
