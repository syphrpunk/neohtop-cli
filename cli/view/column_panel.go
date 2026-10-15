package view

import (
	"strings"

	"github.com/syphrpunk/sloppytop/theme"
	"charm.land/lipgloss/v2"
)

// ColumnPanel renders a column visibility toggle overlay
type ColumnPanel struct {
	theme *theme.Theme
}

func NewColumnPanel(th *theme.Theme) *ColumnPanel {
	return &ColumnPanel{theme: th}
}

func (cp *ColumnPanel) SetTheme(th *theme.Theme) {
	cp.theme = th
}

// AllColumns defines all possible columns and their labels
var AllColumns = []struct {
	ID       string
	Label    string
	Required bool
}{
	{"pid", "PID", true},
	{"name", "Name", true},
	{"command", "Command", false},
	{"threads", "Threads", false},
	{"user", "User", false},
	{"memory", "Memory", false},
	{"cpu", "CPU%", false},
	{"status", "Status", false},
	{"runtime", "Runtime", false},
	{"disk", "Disk I/O", false},
}

func (cp *ColumnPanel) Render(visibleColumns []string, activeLine int, width, height int) string {
	th := cp.theme

	hotkey := lipgloss.NewStyle().Foreground(th.Purple).Bold(true)
	dim := lipgloss.NewStyle().Foreground(th.Overlay0)
	sel := lipgloss.NewStyle().Foreground(th.Peach).Bold(true)
	on := lipgloss.NewStyle().Foreground(th.Green).Bold(true)
	off := lipgloss.NewStyle().Foreground(th.Overlay0)
	lock := lipgloss.NewStyle().Foreground(th.Subtext0)
	colLabel := lipgloss.NewStyle().Foreground(th.Text)
	sep := lipgloss.NewStyle().Foreground(th.Surface1)

	contentW := 36

	// Title
	title := lipgloss.NewStyle().Foreground(th.Purple).Bold(true).Render("Columns")
	close := hotkey.Render("esc") + dim.Render(" close")
	gap := contentW - lipgloss.Width(title) - lipgloss.Width(close)
	if gap < 1 {
		gap = 1
	}
	titleLine := title + spaces(gap) + close
	divider := sep.Render(strings.Repeat("─", contentW))

	visibleSet := make(map[string]bool)
	for _, c := range visibleColumns {
		visibleSet[c] = true
	}

	var rows []string
	for i, col := range AllColumns {
		marker := "  "
		if i == activeLine {
			marker = sel.Render(IconArrowR + " ")
		}

		var status string
		if col.Required {
			status = lock.Render(IconLock) + " " + colLabel.Render(col.Label) + dim.Render(" (required)")
		} else if visibleSet[col.ID] {
			status = on.Render(IconCheck) + " " + colLabel.Render(col.Label)
		} else {
			status = off.Render(IconClose) + " " + dim.Render(col.Label)
		}

		rows = append(rows, marker+status)
	}

	var lines []string
	lines = append(lines, titleLine, divider, "")
	lines = append(lines, rows...)
	lines = append(lines, "", divider)
	lines = append(lines, dim.Render("↑↓ navigate  Enter/Space toggle"))

	content := strings.Join(lines, "\n")

	box := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(th.Surface1).
		Padding(1, 2).
		Width(contentW + 6)

	rendered := box.Render(content)
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, rendered)
}
