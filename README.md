<div align="center">

# 👻 Sloppytop

**A cross-platform terminal process monitor with btop-style visualizations**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![Release](https://img.shields.io/github/v/release/syphrpunk/neohtop-cli?color=purple)](https://github.com/syphrpunk/neohtop-cli/releases)

A terminal process monitor — originally the CLI companion to [NeoHtop](https://github.com/Abdenasser/NeoHtop). The prebuilt binary is `sloppytop`. `sloppytop tui` opens the screen.

[Installation](#installation) · [Features](#features) · [Keybindings](#keybindings) · [Themes](#themes) · [Configuration](#configuration)

<br/>

<img src="assets/demo.gif" alt="Sloppytop demo" width="820" />

<br/>

<img src="assets/neohtop-cli.JPG" alt="Sloppytop screenshot" width="820" />

</div>

<br/>

## Installation

Download a prebuilt `sloppytop` binary from this repo's [releases](https://github.com/syphrpunk/neohtop-cli/releases). `sloppytop tui` opens the process monitor. `sloppytop --help` lists the other commands.

The macOS release build is Apple Silicon. An Intel Mac runs this checkout with bun.

<details>
<summary><b>macOS (Apple Silicon)</b></summary>

```bash
curl -LO https://github.com/syphrpunk/neohtop-cli/releases/latest/download/sloppytop-macos-arm64.tar.gz
tar xzf sloppytop-macos-arm64.tar.gz
sudo mv sloppytop-macos-arm64 /usr/local/bin/sloppytop
```

</details>

<details>
<summary><b>Linux</b></summary>

```bash
# x86_64
curl -LO https://github.com/syphrpunk/neohtop-cli/releases/latest/download/sloppytop-linux-amd64.tar.gz
tar xzf sloppytop-linux-amd64.tar.gz
sudo mv sloppytop-linux-amd64 /usr/local/bin/sloppytop

# ARM64
curl -LO https://github.com/syphrpunk/neohtop-cli/releases/latest/download/sloppytop-linux-arm64.tar.gz
tar xzf sloppytop-linux-arm64.tar.gz
sudo mv sloppytop-linux-arm64 /usr/local/bin/sloppytop
```

</details>

<details>
<summary><b>Windows</b></summary>

Download [`sloppytop-windows-amd64.tar.gz`](https://github.com/syphrpunk/neohtop-cli/releases/latest). The archive contains `sloppytop-windows-amd64.exe`.

</details>

<details>
<summary><b>Intel Mac</b></summary>

The release has no Intel Mac binary. Clone the repo and run the checkout:

```bash
git clone https://github.com/syphrpunk/neohtop-cli.git
cd neohtop-cli
mise install
./st tui
```

</details>

<details>
<summary><b>Build from source</b></summary>

Requires [mise](https://mise.jdx.dev) (installs Go, bun, and just from `mise.toml`).

```bash
git clone https://github.com/syphrpunk/neohtop-cli.git
cd neohtop-cli
mise install
./st tui
```

The Go sources in `cli/` are not on the release. `just build` still writes `./sloppytop-cli` on this machine.

</details>

<br/>

## Features

<table>
<tr>
<td width="50%">

**Real-time monitoring**
CPU per-core sparklines, memory, disk I/O, and network stats rendered with braille-dot visualizations

</td>
<td width="50%">

**Powerful search**
Regex-powered filtering with live match highlighting — `^chrome`, `name|pid`, `\.log$`

</td>
</tr>
<tr>
<td>

**15 built-in themes**
Catppuccin, Dracula, Tokyo Night, Nord, Gruvbox, Synthwave, and more — switch with `t`

</td>
<td>

**Process management**
Inspect details, kill processes, pin favorites to the top, toggle tree view

</td>
</tr>
<tr>
<td>

**JSON output**
`sloppytop snapshot --format json` pipes structured data to `jq` for scripting and dashboards

</td>
<td>

**Single binary, cross-platform**
macOS, Linux, and Windows — no runtime dependencies

</td>
</tr>
</table>

<br/>

## Quick Start

```bash
sloppytop tui                      # open the process monitor
sloppytop snapshot --format json   # one-shot JSON snapshot
sloppytop --help                   # see all commands
```

Press `?` inside the TUI to see every keybinding.

<br/>

## Keybindings

| | Key | Action |
|---|---|---|
| **General** | `q` · `Ctrl+C` | Quit |
| | `?` | Help overlay |
| | `s` · `/` | Search (regex) |
| | `Space` | Pause / resume |
| | `Esc` | Close overlay / clear search |
| **Navigate** | `↑` `↓` `j` | Move selection |
| | `PgUp` · `PgDn` | Page scroll |
| | `Home` · `g` / `End` · `G` | Jump to top / bottom |
| **Process** | `i` · `Enter` | Inspect details |
| | `k` · `x` · `Del` | Kill (with confirmation) |
| | `p` | Pin / unpin |
| **Display** | `0`–`9` | Sort by column |
| | `f` | Filter panel |
| | `c` | Column visibility |
| | `T` | Tree view |
| | `t` | Theme selector |
| | `r` | Cycle refresh rate |
| **Mouse** | Click row | Select process |
| | Double-click | Open details |
| | Click header | Sort by column |
| | Scroll wheel | Navigate list |

<br/>

## Search

Press `s` or `/` to search. Supports full regex:

```
chrome          process name contains "chrome"
^sys            names starting with "sys"
\.log$          commands ending in ".log"
node|deno       matches either
1234            PID 1234
```

Matches are highlighted in yellow in the Name and Command columns.

<br/>

## Themes

Press `t` to open the theme selector with live color swatches.

| | | |
|---|---|---|
| **Charm** *(default)* | **Catppuccin Mocha** | **Catppuccin Latte** |
| **Dracula** | **Tokyo Night** | **Gruvbox Dark** |
| **Nord** | **One Dark** | **Rosé Pine** |
| **Synthwave** | **Solarized Dark** | **Monokai Pro** |
| **High Contrast** | **Green Terminal** | **Amber Terminal** |

<br/>

## JSON Output

`snapshot --format json` outputs system stats and all processes:

```bash
# top 10 by CPU
sloppytop snapshot --format json | jq '[.processes[] | {name, cpu: .cpu_usage}] | sort_by(.cpu) | reverse[:10]'

# memory usage
sloppytop snapshot --format json | jq '.system | {memory_used, memory_total, pct: (.memory_used/.memory_total*100|round)}'

# watch mode
watch -n2 'sloppytop snapshot --format json | jq ".system.cpu_usage_per_core"'
```

<br/>

## Configuration

Screen settings persist at `~/.config/sloppytop/config.json`. An existing `~/.config/neohtop` directory stays in use until the new directory exists.

```json
{
  "tui": {
    "columns": ["pid", "name", "command", "threads", "user", "memory", "cpu"],
    "refreshMs": 1000,
    "theme": "charm"
  }
}
```

**Columns:** `pid` `name` `command` `threads` `user` `memory` `cpu` `status` `runtime` `disk`

**Refresh rates** — cycle with `r`: 1s *(default)* → 2s → 3s → 5s → 0.5s

<br/>

## Architecture

The prebuilt binary is the TypeScript CLI. The Go sources in `cli/` use native OS APIs and are not release assets.

```
┌──────────────────────────────────────────┐
│          Go TUI (Bubble Tea v2)          │
│                                          │
│  Stats Bar · Toolbar · Process Table     │
│  Sparklines · Braille Bars · Overlays    │
├──────────────────────────────────────────┤
│          Native Go Monitor               │
│                                          │
│  process_darwin.go   system_darwin.go    │
│  process_linux.go    system_linux.go     │
│  process_windows.go  system_windows.go   │
└──────────────────────────────────────────┘
```

Built with [Bubble Tea v2](https://github.com/charmbracelet/bubbletea) and [Lip Gloss v2](https://github.com/charmbracelet/lipgloss).

<details>
<summary><b>Project structure</b></summary>

```
neohtop-cli/
├── cli/
│   ├── main.go               # entry point + --json + --version
│   ├── model/                 # Bubble Tea model (state + update loop)
│   ├── view/                  # UI components
│   │   ├── stats_bar.go       #   CPU, memory, network, info panels
│   │   ├── process_table.go   #   main data grid
│   │   ├── toolbar.go         #   button bar
│   │   ├── footer.go          #   status bar
│   │   ├── sparkline.go       #   time-series sparklines
│   │   ├── bar.go             #   braille progress bars
│   │   ├── help.go            #   keybinding overlay
│   │   ├── process_details.go #   process info modal
│   │   ├── kill_confirm.go    #   kill confirmation
│   │   ├── filter_panel.go    #   filter configuration
│   │   ├── column_panel.go    #   column visibility
│   │   ├── theme_panel.go     #   theme selector
│   │   └── process_icons.go   #   140+ Nerd Font icons
│   ├── monitor/               # OS-specific system monitoring
│   ├── theme/                 # 15 color themes
│   ├── filter/                # search, filter, sort, tree
│   └── config/                # persistent user settings
├── justfile
├── mise.toml
└── CONTRIBUTING.md
```

</details>

<br/>

## Sloppytop vs NeoHtop Desktop

| Feature | Desktop | CLI |
|---|:---:|:---:|
| Process monitoring | ✅ | ✅ |
| CPU per-core stats | ✅ | ✅ |
| Memory / Disk / Network | ✅ | ✅ |
| Regex search | ✅ | ✅ |
| Kill / Pin / Inspect | ✅ | ✅ |
| Mouse support | ✅ | ✅ |
| Themes | 12 | **15** |
| Process tree view | — | ✅ |
| JSON scripting | — | ✅ |
| Runs in terminal | — | ✅ |
| Single binary | — | ✅ |

<br/>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and how to add themes, icons, and keybindings.

## License

[MIT](LICENSE)

<br/>

<div align="center">

**[NeoHtop Desktop](https://github.com/Abdenasser/NeoHtop)** · **[Bubble Tea](https://github.com/charmbracelet/bubbletea)** · **[btop](https://github.com/aristocratos/btop)**

Made with 👻 by [Abdenasser](https://github.com/Abdenasser)

</div>
