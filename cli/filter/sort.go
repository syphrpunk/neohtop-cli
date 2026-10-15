package filter

import (
	"sort"
	"strings"

	"github.com/syphrpunk/sloppytop/types"
)

// SortProcesses sorts a slice of processes by the given config.
// Sorts in-place on the input slice (caller should pass a copy if needed).
func SortProcesses(processes []types.Process, cfg types.SortConfig, pinned map[string]bool) []types.Process {
	if len(processes) <= 1 {
		return processes
	}

	hasPins := len(pinned) > 0
	asc := cfg.Direction == types.SortAsc

	sort.SliceStable(processes, func(i, j int) bool {
		a := &processes[i]
		b := &processes[j]

		// Pinned processes always come first
		if hasPins {
			aPinned := pinned[a.Command]
			bPinned := pinned[b.Command]
			if aPinned != bPinned {
				return aPinned
			}
		}

		switch cfg.Field {
		case types.SortByPID:
			if asc {
				return a.PID < b.PID
			}
			return a.PID > b.PID

		case types.SortByName:
			cmp := strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
			if asc {
				return cmp < 0
			}
			return cmp > 0

		case types.SortByCPU:
			if asc {
				return a.CPUUsage < b.CPUUsage
			}
			return a.CPUUsage > b.CPUUsage

		case types.SortByMemory:
			if asc {
				return a.MemoryUsage < b.MemoryUsage
			}
			return a.MemoryUsage > b.MemoryUsage

		case types.SortByStatus:
			cmp := strings.Compare(a.Status, b.Status)
			if asc {
				return cmp < 0
			}
			return cmp > 0

		case types.SortByUser:
			cmp := strings.Compare(strings.ToLower(a.User), strings.ToLower(b.User))
			if asc {
				return cmp < 0
			}
			return cmp > 0

		case types.SortByCommand:
			cmp := strings.Compare(strings.ToLower(a.Command), strings.ToLower(b.Command))
			if asc {
				return cmp < 0
			}
			return cmp > 0

		case types.SortByRunTime:
			if asc {
				return a.RunTime < b.RunTime
			}
			return a.RunTime > b.RunTime

		case types.SortByDisk:
			aTotal := a.DiskRead + a.DiskWrite
			bTotal := b.DiskRead + b.DiskWrite
			if asc {
				return aTotal < bTotal
			}
			return aTotal > bTotal

		case types.SortByThreads:
			aT := uint32(0)
			bT := uint32(0)
			if a.Threads != nil {
				aT = *a.Threads
			}
			if b.Threads != nil {
				bT = *b.Threads
			}
			if asc {
				return aT < bT
			}
			return aT > bT
		}

		return false
	})

	return processes
}
