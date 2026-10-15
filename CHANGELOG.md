# sloppytop — changelog

User-facing changes. Follows [Keep a Changelog](https://keepachangelog.com/) loosely.

The `handoff-create --changelog` flow appends entries to "## Unreleased" as you go. Release tagging is manual.

---

## Unreleased

### Added

- `proc --files` lists open files for one process. `listen` lists local TCP sockets in LISTEN.
- Hardware inventory includes CPU feature flags when the platform lists them.
- On macOS, system stats include GPU utilization and in-use GPU memory when AGX PerformanceStatistics is present. Process rows include `phys_footprint_bytes` when the rusage read succeeds.
- Every command appends one line to the event log.
- CI builds the Go TUI and the TypeScript CLI on every push and pull request.

### Changed

- The project name is Sloppytop. The TypeScript CLI is `sloppytop`. The Go TUI binary is `sloppytop-cli`.
- An existing `~/.config/neohtop` directory, including `neohtop.db` and `neohtop.log`, stays in use until the new directory and files exist. The Go TUI does the same for `~/.config/neohtop-cli/config.json`.
- `service install` and `service uninstall` also remove the previous launchd agent `com.syphrpunk.neohtop.record` and the systemd units `neohtop-record`.
- OpenMetrics gauge names use the `sloppytop_` prefix.

---
