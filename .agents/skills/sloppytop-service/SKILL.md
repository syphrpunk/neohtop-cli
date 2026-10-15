---
name: sloppytop-service
description: Manage the hourly metrics recorder (launchd agent on macOS, systemd user timer on Linux). Run `sloppytop service --help` for usage details.
requires_bin: sloppytop
command: sloppytop service
---

# sloppytop service install

Install + start a scheduled job that runs `record` on an interval

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--intervalSecs` | `number` | `3600` | Seconds between record runs (default hourly) |

---

# sloppytop service status

Show scheduled-job state and DB stats

---

# sloppytop service uninstall

Stop and remove the scheduled recorder job
