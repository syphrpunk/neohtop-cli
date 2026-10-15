package view

import (
	"fmt"
	"strings"

	"github.com/syphrpunk/sloppytop/theme"
	"github.com/syphrpunk/sloppytop/types"
	"charm.land/lipgloss/v2"
)

// ProcessDetails renders a modal overlay with full process information
type ProcessDetails struct {
	theme *theme.Theme
}

func NewProcessDetails(th *theme.Theme) *ProcessDetails {
	return &ProcessDetails{theme: th}
}

func (pd *ProcessDetails) SetTheme(th *theme.Theme) {
	pd.theme = th
}

func (pd *ProcessDetails) Render(p types.Process, detail *types.ProcessDetail, allProcs []types.Process, width, height int) string {
	th := pd.theme

	boxWidth := width - 4
	if boxWidth < 60 {
		boxWidth = 60
	}
	if boxWidth > 90 {
		boxWidth = 90
	}
	contentW := boxWidth - 6

	// ── Shared styles ──
	hotkey := lipgloss.NewStyle().Foreground(th.Purple).Bold(true)
	dim := lipgloss.NewStyle().Foreground(th.Overlay0)
	sep := lipgloss.NewStyle().Foreground(th.Surface1)
	section := lipgloss.NewStyle().Foreground(th.Lavender).Bold(true)
	label := lipgloss.NewStyle().Foreground(th.Subtext0).Width(14)
	val := lipgloss.NewStyle().Foreground(th.Text)
	danger := lipgloss.NewStyle().Foreground(th.Red).Bold(true)

	// ── Title bar ──
	icon := ProcessIcon(p.Name)
	title := lipgloss.NewStyle().Foreground(th.Purple).Bold(true).Render(icon + " " + p.Name)
	close := hotkey.Render("esc") + dim.Render(" close")
	gap := contentW - lipgloss.Width(title) - lipgloss.Width(close)
	if gap < 1 {
		gap = 1
	}
	titleLine := title + spaces(gap) + close
	divider := sep.Render(strings.Repeat("─", contentW))

	// ── Status pills ──
	cpuColor := th.Green
	switch {
	case p.CPUUsage > 80:
		cpuColor = th.Red
	case p.CPUUsage > 50:
		cpuColor = th.Yellow
	}
	statusColor := th.Text
	switch p.Status {
	case "Running":
		statusColor = th.Green
	case "Sleeping", "Idle":
		statusColor = th.Blue
	case "Stopped":
		statusColor = th.Red
	case "Zombie":
		statusColor = th.Yellow
	}

	pillLabel := lipgloss.NewStyle().Foreground(th.Subtext0)

	pills := pillLabel.Render("PID ") + val.Render(fmt.Sprintf("%d", p.PID)) + dim.Render("  "+IconDot+"  ") +
		pillLabel.Render("Status ") + lipgloss.NewStyle().Foreground(statusColor).Render(p.Status) + dim.Render("  "+IconDot+"  ") +
		pillLabel.Render("🚀 ") + lipgloss.NewStyle().Foreground(cpuColor).Render(FormatPercentage(p.CPUUsage)) + dim.Render("  "+IconDot+"  ") +
		pillLabel.Render("💾 ") + val.Render(FormatBytes(p.MemoryUsage))

	// ── Process Info ──
	infoLines := []string{
		section.Render("📋 Process"),
		label.Render("Name") + val.Render(p.Name),
		label.Render("PID") + val.Render(fmt.Sprintf("%d", p.PID)),
		label.Render("Parent PID") + val.Render(fmt.Sprintf("%d", p.PPID)),
		label.Render("User") + val.Render(p.User),
		label.Render("Status") + lipgloss.NewStyle().Foreground(statusColor).Render(p.Status),
	}
	if p.Threads != nil {
		infoLines = append(infoLines, label.Render("Threads")+val.Render(fmt.Sprintf("%d", *p.Threads)))
	}
	if p.SessionID != nil {
		infoLines = append(infoLines, label.Render("Session")+val.Render(fmt.Sprintf("%d", *p.SessionID)))
	}

	// ── Resources ──
	resLines := []string{
		section.Render("⚡ Resources"),
		label.Render("CPU") + lipgloss.NewStyle().Foreground(cpuColor).Render(FormatPercentage(p.CPUUsage)),
		label.Render("Memory") + val.Render(FormatBytes(p.MemoryUsage)),
		label.Render("Virtual Mem") + val.Render(FormatBytes(p.VirtualMemory)),
		label.Render("Disk Read") + val.Render(FormatBytesCompact(p.DiskRead)),
		label.Render("Disk Write") + val.Render(FormatBytesCompact(p.DiskWrite)),
		label.Render("Runtime") + val.Render(FormatRuntime(p.RunTime)),
	}

	// ── Command ──
	cmdLines := []string{
		section.Render("💻 Command"),
		val.Render(Truncate(p.Command, contentW)),
	}
	if p.Root != "" {
		cmdLines = append(cmdLines, dim.Render(Truncate(p.Root, contentW)))
	}

	// ── Children ──
	children := findChildren(p.PID, allProcs)
	var childLines []string
	if len(children) > 0 {
		childLines = append(childLines, section.Render(fmt.Sprintf("🌿 Children (%d)", len(children))))
		header := dim.Render(PadRight("Name", 20) + PadRight("PID", 8) + PadRight("CPU", 8) + "Memory")
		childLines = append(childLines, header)
		max := 6
		for i, c := range children {
			if i >= max {
				childLines = append(childLines, dim.Render(fmt.Sprintf("  +%d more", len(children)-max)))
				break
			}
			childLines = append(childLines,
				val.Render(PadRight(Truncate(c.Name, 18), 20))+
					val.Render(PadRight(fmt.Sprintf("%d", c.PID), 8))+
					lipgloss.NewStyle().Foreground(cpuColor).Render(PadRight(FormatPercentage(c.CPUUsage), 8))+
					val.Render(FormatBytes(c.MemoryUsage)))
		}
	}

	// ── Environment ──
	var envLines []string
	if detail != nil && len(detail.Environ) > 0 {
		envLines = append(envLines, section.Render(fmt.Sprintf("🔧 Environment (%d)", len(detail.Environ))))
		max := 5
		for i, env := range detail.Environ {
			if i >= max {
				envLines = append(envLines, dim.Render(fmt.Sprintf("  +%d more", len(detail.Environ)-max)))
				break
			}
			envLines = append(envLines, dim.Render(Truncate(env, contentW)))
		}
	} else if detail == nil {
		envLines = append(envLines, section.Render("🔧 Environment"))
		envLines = append(envLines, dim.Render("Loading..."))
	}

	// ── Assemble ──
	var lines []string
	lines = append(lines, titleLine, divider, pills, "")
	lines = append(lines, infoLines...)
	lines = append(lines, "")
	lines = append(lines, resLines...)
	lines = append(lines, "")
	lines = append(lines, cmdLines...)
	if len(childLines) > 0 {
		lines = append(lines, "")
		lines = append(lines, childLines...)
	}
	if len(envLines) > 0 {
		lines = append(lines, "")
		lines = append(lines, envLines...)
	}

	// ── Footer ──
	lines = append(lines, "")
	lines = append(lines, divider)
	kHint := danger.Render("k") + dim.Render(" ☠️ kill")
	pHint := hotkey.Render("p") + dim.Render(" 📌 pin")
	eHint := hotkey.Render("esc") + dim.Render(" close")
	lines = append(lines, kHint+"    "+pHint+"    "+eHint)

	content := strings.Join(lines, "\n")

	box := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(th.Surface1).
		Padding(1, 2).
		Width(boxWidth)

	rendered := box.Render(content)
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, rendered)
}

func findChildren(pid uint32, procs []types.Process) []types.Process {
	var children []types.Process
	for _, p := range procs {
		if p.PPID == pid && p.PID != pid {
			children = append(children, p)
		}
	}
	return children
}
