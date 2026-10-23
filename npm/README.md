# 👻 Sloppytop

**A cross-platform terminal process monitor with btop-style visualizations**

A terminal process monitor — originally the CLI companion to [NeoHtop](https://github.com/Abdenasser/NeoHtop). The package installs the `sloppytop` binary. `sloppytop tui` opens the screen.

![Sloppytop](https://raw.githubusercontent.com/syphrpunk/neohtop-cli/main/assets/neohtop-cli.JPG)

## Install

```bash
bun install -g sloppytop-cli
```

Or with npm:

```bash
npm install -g sloppytop-cli
```

The package downloads the prebuilt `sloppytop` binary for your platform on install (or on first run if install scripts are disabled, as they are by default under bun). The macOS build is Apple Silicon. An Intel Mac runs `./st` from a checkout of the repo.

## Usage

```bash
sloppytop tui                      # open the process monitor
sloppytop snapshot --format json   # one-shot JSON snapshot
sloppytop --help                   # see all commands
```

`sloppytop-cli` runs the same binary.

## Features

- **Real-time monitoring** — CPU per-core sparklines, memory, disk, network stats with braille-dot visualizations
- **Process management** — search (regex), filter, sort, kill, pin, inspect, tree view
- **15 built-in themes** — Catppuccin, Dracula, Tokyo Night, Nord, Gruvbox, and more
- **JSON output** — pipe to `jq` for scripting and dashboards
- **Mouse support** — click to select, click headers to sort, scroll wheel
- **Single binary** — macOS, Linux, Windows, no runtime dependencies

## Keybindings

| Key | Action |
|---|---|
| `q` / `Ctrl+C` | Quit |
| `s` / `/` | Search (regex) |
| `?` | Help overlay |
| `i` / `Enter` | Inspect process |
| `k` / `Del` | Kill process |
| `p` | Pin process |
| `T` | Tree view |
| `t` | Theme selector |
| `f` | Filter panel |
| `c` | Column visibility |
| `Space` | Pause / resume |

## Links

- [GitHub](https://github.com/syphrpunk/neohtop-cli) — full docs, screenshots, and source
- [NeoHtop Desktop](https://github.com/Abdenasser/NeoHtop) — the GUI version
- [Releases](https://github.com/syphrpunk/neohtop-cli/releases) — prebuilt binaries

## License

MIT
