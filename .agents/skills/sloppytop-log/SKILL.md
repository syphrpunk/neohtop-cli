---
name: sloppytop-log
description: Show recent probe log lines from probes.jsonl. Each enabled probe appends one JSON line when it runs. Process command lines and environment values are not written. Run `sloppytop log --help` for usage details.
requires_bin: sloppytop
command: sloppytop log
---

# sloppytop log

Show recent probe log lines from probes.jsonl. Each enabled probe appends one JSON line when it runs. Process command lines and environment values are not written.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--probe` | `string` |  | Only this probe name |
| `--limit` | `number` | `50` | Newest lines to return |
