---
name: sloppytop-probe
description: Turn monitoring probes on or off. An off probe is omitted from command output, probes.jsonl, and GET /metrics. cpu, memory, disk, network, and host stay required for record. Run `sloppytop probe --help` for usage details.
requires_bin: sloppytop
command: sloppytop probe
---

# sloppytop probe disable

Disable one or more probes (comma-separated)

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `names` | `string` | yes | Probe names, comma-separated |

---

# sloppytop probe enable

Enable one or more probes (comma-separated)

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `names` | `string` | yes | Probe names, comma-separated |

---

# sloppytop probe list

Show the effective probe switches and the metrics listener settings
