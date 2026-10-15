package view

import (
	"fmt"
	"strings"

	"github.com/syphrpunk/sloppytop/filter"
	"github.com/syphrpunk/sloppytop/theme"
	"charm.land/lipgloss/v2"
)

// FilterPanel renders an interactive filter configuration overlay
type FilterPanel struct {
	theme *theme.Theme
}

func NewFilterPanel(th *theme.Theme) *FilterPanel {
	return &FilterPanel{theme: th}
}

func (fp *FilterPanel) SetTheme(th *theme.Theme) {
	fp.theme = th
}

func (fp *FilterPanel) Render(cfg filter.Config, activeLine int, width, height int) string {
	th := fp.theme

	hotkey := lipgloss.NewStyle().Foreground(th.Purple).Bold(true)
	dim := lipgloss.NewStyle().Foreground(th.Overlay0)
	section := lipgloss.NewStyle().Foreground(th.Lavender).Bold(true)
	sel := lipgloss.NewStyle().Foreground(th.Peach).Bold(true)
	label := lipgloss.NewStyle().Foreground(th.Subtext1)
	on := lipgloss.NewStyle().Foreground(th.Green).Bold(true)
	off := lipgloss.NewStyle().Foreground(th.Overlay0)
	sep := lipgloss.NewStyle().Foreground(th.Surface1)

	contentW := 50

	// Title
	title := lipgloss.NewStyle().Foreground(th.Purple).Bold(true).Render("Filters")
	close := hotkey.Render("esc") + dim.Render(" close")
	gap := contentW - lipgloss.Width(title) - lipgloss.Width(close)
	if gap < 1 {
		gap = 1
	}
	titleLine := title + spaces(gap) + close
	divider := sep.Render(strings.Repeat("─", contentW))

	// Helpers
	numStatus := func(f filter.NumericFilter) string {
		if f.Enabled {
			return on.Render(IconCheck) + label.Render(fmt.Sprintf(" %s %.0f", f.Operator, f.Value))
		}
		return off.Render(IconClose + " off")
	}

	statusStatus := func(f filter.StatusFilter) string {
		if f.Enabled && len(f.Values) > 0 {
			var colored []string
			for _, v := range f.Values {
				switch v {
				case "Running":
					colored = append(colored, lipgloss.NewStyle().Foreground(th.Green).Render(v))
				case "Sleeping":
					colored = append(colored, lipgloss.NewStyle().Foreground(th.Blue).Render(v))
				case "Stopped":
					colored = append(colored, lipgloss.NewStyle().Foreground(th.Red).Render(v))
				case "Zombie":
					colored = append(colored, lipgloss.NewStyle().Foreground(th.Yellow).Render(v))
				default:
					colored = append(colored, v)
				}
			}
			return on.Render(IconCheck+" ") + strings.Join(colored, dim.Render(", "))
		}
		return off.Render(IconClose + " off")
	}

	marker := func(line int) string {
		if line == activeLine {
			return sel.Render(IconArrowR + " ")
		}
		return "  "
	}

	lines := []string{
		titleLine,
		divider,
		"",
		section.Render("Performance"),
		marker(0) + label.Render(PadRight("CPU %", 12)) + numStatus(cfg.CPU),
		marker(1) + label.Render(PadRight("RAM (MB)", 12)) + numStatus(cfg.RAM),
		marker(2) + label.Render(PadRight("Runtime", 12)) + numStatus(cfg.Runtime),
		"",
		section.Render("Status"),
		marker(3) + label.Render(PadRight("Status", 12)) + statusStatus(cfg.Status),
		"",
		divider,
		dim.Render("↑↓ navigate  Enter toggle  ←→ operator  +/- value"),
	}

	content := strings.Join(lines, "\n")

	box := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(th.Surface1).
		Padding(1, 2).
		Width(contentW + 6)

	rendered := box.Render(content)
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, rendered)
}
