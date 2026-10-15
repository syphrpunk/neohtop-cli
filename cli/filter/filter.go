package filter

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/syphrpunk/sloppytop/types"
)

// Config holds filter settings
type Config struct {
	CPU     NumericFilter
	RAM     NumericFilter
	Runtime NumericFilter
	Status  StatusFilter
}

// NumericFilter represents a numeric comparison filter
type NumericFilter struct {
	Enabled  bool
	Operator string
	Value    float64
}

// StatusFilter represents a status inclusion filter
type StatusFilter struct {
	Enabled bool
	Values  []string
}

// NewConfig returns a default (empty) filter config
func NewConfig() Config {
	return Config{
		CPU:     NumericFilter{Operator: ">"},
		RAM:     NumericFilter{Operator: ">"},
		Runtime: NumericFilter{Operator: ">"},
		Status:  StatusFilter{},
	}
}

// regexCache avoids recompiling regex patterns
var regexCache = make(map[string]*regexp.Regexp)

// FilterProcesses filters processes by search term and filter config.
// When no filters are active, returns the input slice directly (zero-copy).
func FilterProcesses(processes []types.Process, searchTerm string, cfg Config) []types.Process {
	noFilters := searchTerm == "" && !cfg.CPU.Enabled && !cfg.RAM.Enabled && !cfg.Runtime.Enabled && !cfg.Status.Enabled
	if noFilters {
		// No filtering needed — return slice directly, no copy
		return processes
	}

	// Pre-compute lowercase search terms once
	var terms []string
	var termsLower []string
	if searchTerm != "" {
		for _, t := range strings.Split(searchTerm, ",") {
			t = strings.TrimSpace(t)
			if t != "" {
				terms = append(terms, t)
				termsLower = append(termsLower, strings.ToLower(t))
			}
		}
	}

	result := make([]types.Process, 0, len(processes)/2)

	for _, p := range processes {
		// Status filter (cheapest — string compare)
		if cfg.Status.Enabled && len(cfg.Status.Values) > 0 {
			found := false
			for _, v := range cfg.Status.Values {
				if strings.EqualFold(p.Status, v) {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}

		// CPU filter (cheap — float compare)
		if cfg.CPU.Enabled {
			if !compareValue(float64(p.CPUUsage), cfg.CPU.Operator, cfg.CPU.Value) {
				continue
			}
		}

		// RAM filter (bytes to MB)
		if cfg.RAM.Enabled {
			ramMB := float64(p.MemoryUsage) / (1024 * 1024)
			if !compareValue(ramMB, cfg.RAM.Operator, cfg.RAM.Value) {
				continue
			}
		}

		// Runtime filter (seconds to minutes)
		if cfg.Runtime.Enabled {
			runtimeMin := float64(p.RunTime) / 60
			if !compareValue(runtimeMin, cfg.Runtime.Operator, cfg.Runtime.Value) {
				continue
			}
		}

		// Search terms — try simple string match first, regex only as fallback
		if len(terms) > 0 {
			matched := false
			nameLower := strings.ToLower(p.Name)
			cmdLower := strings.ToLower(p.Command)
			pidStr := fmt.Sprintf("%d", p.PID)

			for i, term := range terms {
				if strings.Contains(nameLower, termsLower[i]) ||
					strings.Contains(cmdLower, termsLower[i]) ||
					strings.Contains(pidStr, term) {
					matched = true
					break
				}

				// Regex fallback — only if simple match failed
				re, ok := regexCache[term]
				if !ok {
					var err error
					re, err = regexp.Compile("(?i)" + term)
					if err != nil {
						continue
					}
					regexCache[term] = re
				}
				if re.MatchString(p.Name) {
					matched = true
					break
				}
			}

			if !matched {
				continue
			}
		}

		result = append(result, p)
	}

	return result
}

func compareValue(value float64, operator string, target float64) bool {
	switch operator {
	case ">":
		return value > target
	case "<":
		return value < target
	case "=":
		return value == target
	case ">=":
		return value >= target
	case "<=":
		return value <= target
	default:
		return true
	}
}
