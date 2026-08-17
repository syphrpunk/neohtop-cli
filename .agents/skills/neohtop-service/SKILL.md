---
name: neohtop-service
description: Manage the hourly metrics recorder (launchd agent on macOS, systemd user timer on Linux). Run `neohtop service --help` for usage details.
requires_bin: neohtop
command: neohtop service
---

# neohtop service install

Install + start a scheduled job that runs `record` on an interval

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--intervalSecs` | `number` | `3600` | Seconds between record runs (default hourly) |

---

# neohtop service status

Show scheduled-job state and DB stats

---

# neohtop service uninstall

Stop and remove the scheduled recorder job
