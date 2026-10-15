---
name: sloppytop-proc
description: Detailed info for a single process (cwd, children; --env for environment; --files for open files). Open files are omitted when they cannot be measured. Run `sloppytop proc --help` for usage details.
requires_bin: sloppytop
command: sloppytop proc
---

# sloppytop proc

Detailed info for a single process (cwd, children; --env for environment; --files for open files). Open files are omitted when they cannot be measured.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pid` | `number` | yes | Process ID |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--env` | `boolean` | `false` | Include environment variables (same-user processes only without root) |
| `--files` | `boolean` | `false` | Include open files for this process. Omitted when they cannot be measured. Not stored by record |
