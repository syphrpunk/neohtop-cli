package view

import "strings"

// Process icons using Nerd Font glyphs.
// These render as brand/app icons in any Nerd Font-patched terminal font
// (e.g., JetBrainsMono Nerd Font, FiraCode Nerd Font, etc.).
//
// Same matching logic as NeoHtop's ProcessIcon.svelte (simple-icons),
// but using Nerd Font Unicode codepoints instead of SVGs.

// Nerd Font codepoints — brand/dev icons
const (
	nfApple      = "\U000F0035" // 󰀵  Apple
	nfAndroid    = "\U000F0032" // 󰀲  Android
	nfChrome     = "\U000F0288" // 󰊈  Chrome
	nfFirefox    = "\U000F0239" // 󰈹  Firefox
	nfSafari     = "\U000F0584" // 󰖄  Safari
	nfEdge       = "\U000F0139" // 󰄹  Edge
	nfDocker     = "\U000F0868" // 󰡨  Docker
	nfGit        = "\U000F02A2" // 󰊢  Git
	nfGithub     = "\U000F02A4" // 󰊤  GitHub
	nfPython     = "\U000F0320" // 󰌠  Python
	nfNodejs     = "\U000F0399" // 󰎙  Node.js
	nfRust       = "\U000F0B75" // 󰭵  Rust (deshret)
	nfGo         = "\U000F07D3" // 󰟓  Go gopher
	nfJava       = "\U000F0176" // 󰅶  Java
	nfSwift      = "\U000F06E5" // 󰛥  Swift
	nfTerminal   = "\U000F0489" // 󰒉  Terminal
	nfCode       = "\U000F0A1E" // 󰨞  VS Code
	nfDatabase   = "\U000F01BC" // 󰆼  Database
	nfServer     = "\U000F048B" // 󰒋  Server
	nfCloud      = "\U000F015F" // 󰅟  Cloud
	nfNetwork    = "\U000F06F3" // 󰛳  Network
	nfBluetooth  = "\U000F00AF" // 󰂯  Bluetooth
	nfWifi       = "\U000F05A9" // 󰖩  WiFi
	nfMusic      = "\U000F075A" // 󰝚  Music
	nfVideo      = "\U000F075C" // 󰝜  Video/Film
	nfSpotify    = "\U000F04C7" // 󰓇  Spotify
	nfSlack      = "\U000F04B1" // 󰒱  Slack
	nfDiscord    = "\U000F066F" // 󰙯  Discord
	nfTelegram   = "\U000F0544" // 󰕄  Telegram
	nfElectron   = "\U000F0B2C" // 󰬬  Electron (atom)
	nfKeyboard   = "\U000F030C" // 󰌌  Keyboard
	nfLock       = "\U000F033E" // 󰌾  Lock/Security
	nfCog        = "\U000F0493" // 󰒓  Cog/Settings
	nfCube       = "\U000F01A6" // 󰆦  Package/Cube
	nfEye        = "\U000F0208" // 󰈈  Eye/Monitor
	nfClipboard  = "\U000F0147" // 󰅇  Clipboard
	nfFolder     = "\U000F024B" // 󰉋  Folder
	nfConsole    = "\U000F018D" // 󰆍  Console
	nfLinux      = "\U000F033D" // 󰌽  Linux
	nfWindows    = "\U000F05B3" // 󰖳  Windows
	nfNvidia     = "\U000F0BAD" // 󰮭  Nvidia
	nfRuby       = "\U000F0D2D" // 󰴭  Ruby
	nfPhp        = "\U000F0B71" // 󰭱  PHP (elephant)
	nfReact      = "\U000F0708" // 󰜈  React (atom)
	nfVim        = "\U000F0355" // 󰍕  Vim
	nfFigma      = "\ue771"     //   Figma

	// Default fallback
	nfDefault = "\U000F0489" // 󰒉  Terminal (generic process)
)

// processIconMap maps lowercase process names (or fragments) to Nerd Font icons.
// Order doesn't matter — exact match is tried first, then prefix/contains.
var processIconMap = map[string]string{
	// ── Apple / macOS system processes ───────────────────────────────
	"kernel_task":        nfApple,
	"launchd":            nfApple,
	"windowserver":       nfApple,
	"dock":               nfApple,
	"finder":             nfFolder,
	"spotlight":          nfApple,
	"mds":                nfApple,
	"mds_stores":         nfApple,
	"mdworker":           nfApple,
	"coreaudiod":         nfMusic,
	"corespotlightd":     nfApple,
	"coreservicesd":      nfApple,
	"syslogd":            nfServer,
	"notifyd":            nfApple,
	"diskarbitrationd":   nfDatabase,
	"cfprefsd":           nfCog,
	"logd":               nfServer,
	"opendirectoryd":     nfFolder,
	"loginwindow":        nfLock,
	"securityd":          nfLock,
	"trustd":             nfLock,
	"syspolicyd":         nfLock,
	"authd":              nfLock,
	"keychain":           nfLock,
	"bluetoothd":         nfBluetooth,
	"airportd":           nfWifi,
	"wifid":              nfWifi,
	"systemuiserver":     nfApple,
	"usernoted":          nfApple,
	"useractivityd":      nfApple,
	"iconservicesagent":  nfApple,
	"powerd":             nfApple,
	"thermald":           nfApple,
	"timed":              nfApple,
	"remoted":            nfNetwork,
	"rapportd":           nfNetwork,
	"sharingd":           nfNetwork,
	"networkserviceproxy": nfNetwork,
	"symptomsd":          nfNetwork,
	"configd":            nfNetwork,
	"mDNSResponder":      nfNetwork,
	"mdnsresponder":      nfNetwork,
	"nsurlsessiond":      nfNetwork,
	"cloudd":             nfCloud,
	"bird":               nfCloud, // iCloud daemon
	"fileproviderd":      nfCloud,
	"lsd":                nfApple, // Launch Services daemon
	"pboard":             nfClipboard,
	"corebrightnessd":    nfApple,
	"displaypolicyd":     nfEye,
	"distnoted":          nfApple,

	// ── Browsers ────────────────────────────────────────────────────
	"google chrome":       nfChrome,
	"chrome":              nfChrome,
	"google chrome helper": nfChrome,
	"chromium":            nfChrome,
	"firefox":             nfFirefox,
	"safari":              nfSafari,
	"webkit":              nfSafari,
	"microsoft edge":      nfEdge,
	"msedge":              nfEdge,
	"arc":                 nfChrome,
	"brave":               nfChrome,
	"opera":               nfChrome,
	"vivaldi":             nfChrome,

	// ── Terminals & Shells ──────────────────────────────────────────
	"terminal":     nfTerminal,
	"iterm2":       nfTerminal,
	"iterm":        nfTerminal,
	"alacritty":    nfTerminal,
	"kitty":        nfTerminal,
	"wezterm":      nfTerminal,
	"hyper":        nfTerminal,
	"warp":         nfTerminal,
	"ghostty":      nfTerminal,
	"bash":         nfConsole,
	"zsh":          nfConsole,
	"fish":         nfConsole,
	"sh":           nfConsole,
	"dash":         nfConsole,
	"nu":           nfConsole,
	"nushell":      nfConsole,
	"tmux":         nfTerminal,
	"screen":       nfTerminal,
	"ssh":          nfTerminal,
	"sshd":         nfLock,

	// ── Editors & IDEs ──────────────────────────────────────────────
	"code":         nfCode,
	"code helper":  nfCode,
	"cursor":       nfCode,
	"vscode":       nfCode,
	"vim":          nfVim,
	"nvim":         nfVim,
	"neovim":       nfVim,
	"emacs":        nfCode,
	"sublime_text": nfCode,
	"sublime":      nfCode,
	"atom":         nfElectron,
	"idea":         nfCode,
	"goland":       nfGo,
	"pycharm":      nfPython,
	"webstorm":     nfCode,
	"clion":        nfCode,
	"rustrover":    nfRust,
	"xcode":        nfSwift,
	"figma":        nfFigma,

	// ── Programming runtimes ────────────────────────────────────────
	"node":    nfNodejs,
	"nodejs":  nfNodejs,
	"deno":    nfNodejs,
	"bun":     nfNodejs,
	"python":  nfPython,
	"python3": nfPython,
	"python2": nfPython,
	"pip":     nfPython,
	"ruby":    nfRuby,
	"irb":     nfRuby,
	"gem":     nfRuby,
	"java":    nfJava,
	"javac":   nfJava,
	"kotlin":  nfJava,
	"go":      nfGo,
	"rustc":   nfRust,
	"cargo":   nfRust,
	"swift":   nfSwift,
	"swiftc":  nfSwift,
	"php":     nfPhp,
	"perl":    nfCog,
	"lua":     nfCog,

	// ── Package managers / build tools ──────────────────────────────
	"npm":     nfNodejs,
	"yarn":    nfNodejs,
	"pnpm":    nfNodejs,
	"webpack": nfNodejs,
	"vite":    nfNodejs,
	"esbuild": nfNodejs,
	"make":    nfCog,
	"cmake":   nfCog,
	"gradle":  nfJava,
	"maven":   nfJava,
	"brew":    nfCube,
	"port":    nfCube,
	"apt":     nfLinux,
	"dpkg":    nfLinux,

	// ── DevOps & Containers ─────────────────────────────────────────
	"docker":         nfDocker,
	"dockerd":        nfDocker,
	"containerd":     nfDocker,
	"kubectl":        nfDocker,
	"kubelet":        nfDocker,
	"podman":         nfDocker,
	"git":            nfGit,
	"gh":             nfGithub,
	"nginx":          nfServer,
	"apache":         nfServer,
	"httpd":          nfServer,
	"caddy":          nfServer,
	"traefik":        nfServer,

	// ── Databases ───────────────────────────────────────────────────
	"postgres":  nfDatabase,
	"postgresql": nfDatabase,
	"mysql":     nfDatabase,
	"mysqld":    nfDatabase,
	"mongod":    nfDatabase,
	"mongo":     nfDatabase,
	"redis":     nfDatabase,
	"redis-server": nfDatabase,
	"sqlite3":   nfDatabase,
	"memcached": nfDatabase,

	// ── Communication ───────────────────────────────────────────────
	"slack":    nfSlack,
	"discord":  nfDiscord,
	"telegram": nfTelegram,
	"zoom":     nfVideo,
	"zoom.us":  nfVideo,
	"teams":    nfVideo,
	"skype":    nfVideo,
	"facetime": nfVideo,
	"messages": nfApple,

	// ── Media ───────────────────────────────────────────────────────
	"spotify":       nfSpotify,
	"music":         nfMusic,
	"itunes":        nfMusic,
	"vlc":           nfVideo,
	"mpv":           nfVideo,
	"quicktime":     nfVideo,
	"photos":        nfApple,
	"preview":       nfEye,

	// ── Electron apps ───────────────────────────────────────────────
	"electron":      nfElectron,
	"notion":        nfElectron,
	"obsidian":      nfElectron,
	"1password":     nfLock,
	"bitwarden":     nfLock,
	"lastpass":      nfLock,
	"claude":        nfElectron,

	// ── GPU / drivers ───────────────────────────────────────────────
	"nvidia-smi":    nfNvidia,
	"amd":           nfCog,

	// ── System monitors (us!) ───────────────────────────────────────
	"neohtop":       nfEye,
	"neohtop-cli":   nfEye,
	"sloppytop":     nfEye,
	"sloppytop-cli": nfEye,
	"htop":          nfEye,
	"btop":          nfEye,
	"top":           nfEye,
	"activity monitor": nfEye,
	"activitymonitor":  nfEye,

	// ── Linux system ────────────────────────────────────────────────
	"systemd":       nfLinux,
	"journald":      nfLinux,
	"init":          nfLinux,
	"cron":          nfCog,
	"crond":         nfCog,
	"dbus":          nfLinux,

	// ── Windows system ──────────────────────────────────────────────
	"explorer":      nfWindows,
	"svchost":       nfWindows,
	"csrss":         nfWindows,
	"dwm":           nfWindows,
	"taskhostw":     nfWindows,
	"services":      nfWindows,
	"winlogon":      nfWindows,
	"powershell":    nfTerminal,
	"cmd":           nfTerminal,
}

// prefixIconMap maps name prefixes to icons (for com.apple.*, etc.)
var prefixIconMap = []struct {
	Prefix string
	Icon   string
}{
	{"com.apple.", nfApple},
	{"com.google.", nfChrome},
	{"com.microsoft.", nfWindows},
	{"com.docker.", nfDocker},
	{"com.spotify.", nfSpotify},
	{"com.slack.", nfSlack},
	{"com.discord.", nfDiscord},
	{"com.github.", nfGithub},
	{"com.nvidia.", nfNvidia},
	{"com.electron.", nfElectron},
	{"org.mozilla.", nfFirefox},
	{"org.chromium.", nfChrome},
}

// ProcessIcon returns a Nerd Font icon for a process name.
// Matching logic mirrors NeoHtop's ProcessIcon.svelte:
//  1. Exact match on cleaned lowercase name
//  2. Prefix match on com.company.* style names
//  3. First-word match (e.g., "Google Chrome Helper" → "google" → Chrome icon)
//  4. Default terminal icon
func ProcessIcon(name string) string {
	if name == "" {
		return nfDefault
	}

	lower := strings.ToLower(name)

	// Clean: strip .app / .exe suffixes
	lower = strings.TrimSuffix(lower, ".app")
	lower = strings.TrimSuffix(lower, ".exe")

	// 1. Exact match
	if icon, ok := processIconMap[lower]; ok {
		return icon
	}

	// 2. Prefix match (com.apple.*, com.google.*, etc.)
	for _, pm := range prefixIconMap {
		if strings.HasPrefix(lower, pm.Prefix) {
			return pm.Icon
		}
	}

	// 3. First-word match — handles "Google Chrome Helper" → "google"
	cleaned := strings.NewReplacer(
		"-", " ", "_", " ", ".", " ", "/", " ", "\\", " ",
	).Replace(lower)
	firstWord := strings.Fields(cleaned)
	if len(firstWord) > 0 {
		if icon, ok := processIconMap[firstWord[0]]; ok {
			return icon
		}
	}

	return nfDefault
}
