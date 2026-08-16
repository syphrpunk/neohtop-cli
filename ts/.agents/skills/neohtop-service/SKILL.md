---
name: neohtop-service
description: Manage the hourly metrics recorder (launchd user agent). Run `neohtop service --help` for usage details.
requires_bin: neohtop
command: neohtop service
---

# neohtop service install

Install + start a launchd agent that runs `record` on an interval

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--intervalSecs` | `number` | `3600` | Seconds between record runs (default hourly) |

---

# neohtop service status

Show agent state and DB stats

---

# neohtop service uninstall

Stop and remove the launchd agent
