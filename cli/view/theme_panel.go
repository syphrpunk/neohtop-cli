package view

import (
	"image/color"
	"strings"

	"github.com/syphrpunk/sloppytop/theme"
	"charm.land/lipgloss/v2"
)

// ThemePanel renders a theme selector overlay with color previews
type ThemePanel struct {
	theme *theme.Theme
}

func NewThemePanel(th *theme.Theme) *ThemePanel {
	return &ThemePanel{theme: th}
}

func (tp *ThemePanel) SetTheme(th *theme.Theme) {
	tp.theme = th
}

func (tp *ThemePanel) Render(currentTheme string, activeLine int, width, height int) string {
	th := tp.theme

	hotkey := lipgloss.NewStyle().Foreground(th.Purple).Bold(true)
	dim := lipgloss.NewStyle().Foreground(th.Overlay0)
	sel := lipgloss.NewStyle().Foreground(th.Peach).Bold(true)
	active := lipgloss.NewStyle().Foreground(th.Green).Bold(true)
	labelStyle := lipgloss.NewStyle().Foreground(th.Text)
	sep := lipgloss.NewStyle().Foreground(th.Surface1)

	contentW := 44

	// Title
	title := lipgloss.NewStyle().Foreground(th.Purple).Bold(true).Render("Themes")
	close := hotkey.Render("esc") + dim.Render(" close")
	gap := contentW - lipgloss.Width(title) - lipgloss.Width(close)
	if gap < 1 {
		gap = 1
	}
	titleLine := title + spaces(gap) + close
	divider := sep.Render(strings.Repeat("─", contentW))

	names := theme.ThemeNames()

	// Find longest label for alignment (use runecount, not byte length)
	maxLabelW := 0
	for _, name := range names {
		t := theme.GetTheme(name)
		w := lipgloss.Width(t.Label)
		if w > maxLabelW {
			maxLabelW = w
		}
	}

	var rows []string
	for i, name := range names {
		t := theme.GetTheme(name)

		// Selection marker
		marker := "  "
		if i == activeLine {
			marker = sel.Render(IconArrowR + " ")
		}

		// Active indicator
		var indicator string
		if name == currentTheme {
			indicator = active.Render(IconBullet) + " "
		} else {
			indicator = "  "
		}

		// Theme label padded to fixed width
		labelW := lipgloss.Width(t.Label)
		padded := t.Label + strings.Repeat(" ", maxLabelW-labelW)
		var label string
		if i == activeLine {
			label = sel.Render(padded)
		} else if name == currentTheme {
			label = active.Render(padded)
		} else {
			label = labelStyle.Render(padded)
		}

		// Color swatches — show key colors as colored blocks
		swatch := renderSwatch(t)

		rows = append(rows, marker+indicator+label+"  "+swatch)
	}

	var lines []string
	lines = append(lines, titleLine, divider, "")
	lines = append(lines, rows...)
	lines = append(lines, "", divider)
	lines = append(lines, dim.Render("↑↓ navigate  Enter/Space apply"))

	content := strings.Join(lines, "\n")

	box := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(th.Surface1).
		Padding(1, 2).
		Width(contentW + 6)

	rendered := box.Render(content)
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, rendered)
}

// renderSwatch creates a row of colored block characters showing the theme's palette
func renderSwatch(t *theme.Theme) string {
	colors := []color.Color{
		t.Blue,
		t.Lavender,
		t.Green,
		t.Yellow,
		t.Peach,
		t.Red,
		t.Teal,
		t.Purple,
	}

	var b strings.Builder
	for _, c := range colors {
		b.WriteString(lipgloss.NewStyle().Foreground(c).Render("██"))
	}
	return b.String()
}
