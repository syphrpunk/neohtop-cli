# Contributing to NeoHtop CLI

Thanks for your interest in contributing to NeoHtop CLI! Whether it's a bug fix, new feature, theme, or documentation improvement — all contributions are welcome.

## Getting Started

### Prerequisites

- **[mise](https://mise.jdx.dev)** — installs the toolchain (Go, bun, just) from `mise.toml`
- **C compiler** (gcc or clang) — required for CGo on macOS
- A terminal with Unicode support (most modern terminals work)

### Setup

```bash
# Fork and clone
git clone https://github.com/<your-username>/neohtopcli.git
cd neohtopcli

# Install the toolchain (Go, bun, just)
mise install

# Build
just build

# Run
./neohtop-cli
```

### Development Build

```bash
# Build with race detector for catching concurrency bugs
just dev

# Run tests
just test
```

## Project Structure

Understanding the codebase before diving in:

```
cli/
├── main.go            # Entry point — starts the Bubble Tea program
├── model/app.go       # Main app model — state, Update(), View(), key handling
├── view/              # All UI rendering (most visual work happens here)
├── monitor/           # OS-specific process & system data collection
├── theme/             # Color theme definitions
├── filter/            # Search, filter, and sort logic
└── config/            # Persistent user settings (~/.config/neohtop-cli/)
```

### Key Concepts

**Bubble Tea architecture**: The app follows the Elm architecture — `Model` holds state, `Update()` handles messages, `View()` renders the UI. All keyboard/mouse input flows through `Update()` in `model/app.go`.

**View components**: Each file in `view/` is a self-contained component with its own struct, constructor (`New*`), `SetTheme()` method, and `Render()` function. Components don't talk to each other directly — the app model orchestrates them.

**Theme system**: Every component receives a `*theme.Theme` with named colors (Purple, Green, Surface0, etc.). When the user switches themes, `applyTheme()` in app.go calls `SetTheme()` on every component.

## How to Contribute

### Reporting Bugs

Open an issue with:
- Your OS and terminal emulator
- Steps to reproduce
- Expected vs actual behavior
- Terminal screenshot if it's a visual bug

### Adding a Theme

Themes live in `cli/theme/catppuccin.go`. Each theme needs 24 colors:

```go
"mytheme": {
    Name:     "mytheme",
    Label:    "My Theme",
    Base:     lipgloss.Color("#1e1e2e"),  // Main background
    Mantle:   lipgloss.Color("#181825"),  // Deeper background
    Crust:    lipgloss.Color("#11111b"),  // Deepest background
    Text:     lipgloss.Color("#cdd6f4"),  // Primary text
    Subtext0: lipgloss.Color("#a6adc8"),  // Secondary text
    Subtext1: lipgloss.Color("#bac2de"),  // Tertiary text
    Surface0: lipgloss.Color("#313244"),  // UI surface (selected rows)
    Surface1: lipgloss.Color("#45475a"),  // Borders, dividers
    Surface2: lipgloss.Color("#585b70"),  // Inactive elements
    Overlay0: lipgloss.Color("#6c7086"),  // Dim text, separators
    Overlay1: lipgloss.Color("#7f849c"),  // Headers, labels
    Blue:     lipgloss.Color("#89b4fa"),  // Primary accent
    Lavender: lipgloss.Color("#b4befe"),  // Selection, pinned
    Sapphire: lipgloss.Color("#74c7ec"),  // Info accent
    Sky:      lipgloss.Color("#89dceb"),  // Secondary accent
    Red:      lipgloss.Color("#f38ba8"),  // Errors, kill, danger
    Maroon:   lipgloss.Color("#eba0ac"),  // High CPU warning
    Peach:    lipgloss.Color("#fab387"),  // Medium warnings
    Yellow:   lipgloss.Color("#f9e2af"),  // Caution, search highlight
    Green:    lipgloss.Color("#a6e3a1"),  // Running, healthy
    Teal:     lipgloss.Color("#94e2d5"),  // Network, secondary
    Purple:   lipgloss.Color("#cba6f7"),  // Hotkeys, branding
    Pink:     lipgloss.Color("#f5c2e7"),  // Accent gradient
    Indigo:   lipgloss.Color("#93a4f5"),  // Accent gradient
    Fuchsia:  lipgloss.Color("#e78fcf"),  // Accent gradient
},
```

After adding it, the theme automatically appears in the theme selector (`t` key).

### Adding a View Component

1. Create `cli/view/mycomponent.go`
2. Define a struct with a `theme *theme.Theme` field
3. Add `New*()`, `SetTheme()`, and `Render()` methods
4. Wire it into `model/app.go` — add the field, initialize in `NewApp()`, call `SetTheme()` in `applyTheme()`

### Adding Process Icons

Process icons are mapped in `cli/view/process_icons.go`. The function `ProcessIcon()` matches process names to Nerd Font icons. To add a new mapping:

```go
// In the processIcons map
"myapp": "\Uf0000",  // nf-md-icon_name
```

Icon lookup uses exact match → prefix match → first word match → fallback.

### Adding a Keybinding

1. Add the key case in `handleKeyPress()` in `model/app.go`
2. Update the help overlay in `view/help.go`
3. If it's a toolbar action, update `view/toolbar.go`

## Code Style

### Go

- Follow standard Go conventions (`gofmt`, `go vet`)
- Use `lipgloss.Width()` instead of `len()` for strings with Unicode/emoji (multi-byte characters)
- Keep view components stateless where possible — state lives in the app model
- Use theme colors by name (e.g., `th.Purple`, `th.Surface0`) — never hardcode hex colors in views

### Commits

- Write clear commit messages describing the "why", not just the "what"
- Keep commits focused — one logical change per commit
- Reference issue numbers when applicable: `Fix #42: handle zombie process status`

### Pull Requests

- Fork the repo, create a feature branch
- Keep PRs focused on a single feature or fix
- Include a screenshot for visual changes
- Test on at least one platform (macOS or Linux)
- Make sure `just build` succeeds

## Architecture Guidelines

### Do

- Use the existing theme system for all colors
- Use emoji for user-facing labels, Unicode symbols for data visualization
- Keep the toolbar responsive — it has 3 layout tiers (full → compact → emoji-only)
- Use `lipgloss.Width()` for any string width calculation involving styled text
- Test with multiple themes — especially Catppuccin Latte (light mode)

### Don't

- Don't hardcode terminal widths — always use the `width`/`height` from `WindowSizeMsg`
- Don't add external TUI dependencies — stick with the Charm ecosystem (Bubble Tea + Lip Gloss)
- Don't use Nerd Font icons in places where standard Unicode works (icons.go vs process_icons.go)
- Don't store transient state in view components — keep it in the app model

## Platform Notes

### macOS
- Uses `libproc` and `mach` APIs via CGo for process info
- System info via `sysctl` (`kern.hostname`, `kern.osproductversion`, etc.)
- Requires CGo enabled (`CGO_ENABLED=1`)

### Linux
- Reads from `/proc` filesystem for process and system data
- System info from `/proc/sys/kernel/`, `/etc/os-release`, `/proc/cpuinfo`
- Can build without CGo (`CGO_ENABLED=0`)

### Windows
- Uses Windows API via `golang.org/x/sys/windows`
- Process info via `CreateToolhelp32Snapshot`
- Requires CGo enabled

## Need Help?

- Open a [GitHub issue](https://github.com/Abdenasser/neohtop-cli/issues) for bugs or feature requests
- Check existing issues before opening a new one
- For questions about the Charm ecosystem, see [charm.sh/docs](https://charm.sh)

---

Thanks for helping make NeoHtop CLI better! 👻
