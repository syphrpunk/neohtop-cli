---
name: sloppytop-metrics
description: Prometheus scrape endpoint for the enabled probes. GET /metrics returns OpenMetrics text. The listener does not bind until metrics is enabled. Run `sloppytop metrics --help` for usage details.
requires_bin: sloppytop
command: sloppytop metrics
---

# sloppytop metrics disable

Refuse metrics serve until enable is run again

---

# sloppytop metrics enable

Allow metrics serve to bind. Does not start the listener

---

# sloppytop metrics serve

Listen for GET /metrics until interrupted. Requires metrics.enabled. Each scrape samples the enabled probes and appends them to the probe log.
