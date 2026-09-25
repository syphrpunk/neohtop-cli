# neohtop-cli — handoff

> **Read this first.** Single entry point for resuming work. Run the
> `handoff-continue` skill for the structured summary. Then read the files
> listed in `.handoff/config.yaml` under `project.readingOrder`.

---

## Required reading order

Read the files listed in `.handoff/config.yaml` under `project.readingOrder`.

---

## State of play

| Phase | Status | Notes |
|---|---|---|
| (initial scaffold) | ✓ | Created by `handoff-init` on 2026-09-25 |

---

<!-- handoff:state -->

HEAD: 72641af feat(ts): report command, sparklines, systemd timer, Windows monitor, self-update

<!-- handoff:state-notes -->
Handoff was bootstrapped this session (`/handoff:init`) and this is the first checkpoint. No product code changed. HEAD is still `72641af` on `main`, level with `origin/main`.

Config choices: Memento for tasks, `just test` as verification, ADRs recorded at `docs/adr/` (directory not created), no phases file, shared gitignore, secrets scan on. Package manager is `custom` because `go.mod` is under `cli/` and `bun.lock` is under `ts/`, so install, typecheck, and build are blank.

The only delta is the scaffold: `HANDOFF.md`, `DEVLOG.md`, `CHANGELOG.md`, `.handoff/`, the protocol block appended to `CLAUDE.md`, and `.handoff/.create-backup/` in `.gitignore`. Open Memento work was not touched: epic `nht-b1794f` (OpenTUI TUI replacement, low, todo).
<!-- /handoff:state-notes -->

<!-- /handoff:state -->

<!-- handoff:recent -->

(no campaign ledger — .handoff/LEDGER.md absent)

<!-- /handoff:recent -->

<!-- handoff:next -->

**Queue: the configured task manager below (source of truth); the configured queue view, if any, is generated from it.**

Open tasks:
(task manager: memento)
{
  "count": 1,
  "items": [
    {
      "id": "nht-b1794f",
      "uuid": "01a00e6e-2b7e-7000-b59f-dae09b769881",
      "slug": "nht-b1794f-opentui-tui-replacement",
      "title": "OpenTUI TUI replacement",
      "status": "todo",
      "type": "epic",
      "parent": null,
      "blockedBy": [],
      "blocking": [],
      "priority": "low",
      "attention": null,
      "attentionReason": null,
      "updatedAt": "2026-08-17T06:34:56.255Z",
      "path": "/Users/dk/ghq/github.com/syphrpunk/neohtop-cli/.memento/items/nht-b1794f-opentui-tui-replacement.md"
    }
  ]
}

<!-- /handoff:next -->

---

## Gotchas

(Add lessons here as they emerge. Carried forward on every `--create --full`.)

---

## Glossary

(Project-specific terms agents should know. Carried forward on every `--create --full`.)

---

## Where to look

| Looking for... | File |
|---|---|
| Architecture decisions | `docs/adr/` |
| Phase/roadmap | `null` |
| Dated checkpoint history | `DEVLOG.md` |
| User-facing changes | `CHANGELOG.md` |
| Handoff config | `.handoff/config.yaml` |
| Archived checkpoints | `.handoff/archive/` |

---

*This file is partly skill-managed. Sections inside `<!-- handoff:* -->` markers are rewritten by `handoff-create`. Everything else is yours to edit freely; the skill preserves your edits across cheap checkpoints and consults them on full checkpoints.*
