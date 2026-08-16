---
name: neohtop-proc
description: Detailed info for a single process (cwd, children; --env for environment). Run `neohtop proc --help` for usage details.
requires_bin: neohtop
command: neohtop proc
---

# neohtop proc

Detailed info for a single process (cwd, children; --env for environment)

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pid` | `number` | yes | Process ID |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--env` | `boolean` | `false` | Include environment variables (same-user processes only without root) |
