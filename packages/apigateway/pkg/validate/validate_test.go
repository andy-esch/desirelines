package validate

import (
	"testing"
)

func TestYear(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		// Valid years
		{"valid current year", "2024", true},
		{"valid min boundary", "2000", true},
		{"valid max boundary", "2050", true},
		{"valid mid range", "2025", true},

		// Invalid years - out of range
		{"below min boundary", "1999", false},
		{"above max boundary", "2051", false},
		{"way below min", "1900", false},
		{"way above max", "2100", false},

		// Invalid format
		{"two digit year", "24", false},
		{"three digit year", "202", false},
		{"five digit year", "20245", false},
		{"very long string", "20242024202420242024", false},
		{"letters", "abcd", false},
		{"mixed alphanumeric", "20a4", false},
		{"empty string", "", false},
		{"spaces", "    ", false},
		{"year with spaces", "2024 ", false},
		{"negative year", "-2024", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Year(tt.input)
			if got != tt.want {
				t.Errorf("Year(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestDate(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		// Valid dates
		{"standard date", "2025-01-15", true},
		{"leap year feb 29", "2024-02-29", true},
		{"year start", "2025-01-01", true},
		{"year end", "2025-12-31", true},
		{"month boundaries", "2025-06-30", true},

		// Invalid dates - bad format
		{"US format", "01/15/2025", false},
		{"EU format", "15-01-2025", false},
		{"no separators", "20250115", false},
		{"wrong separator", "2025/01/15", false},
		{"partial date", "2025-01", false},
		{"empty string", "", false},

		// Invalid dates - impossible values
		{"month 13", "2025-13-01", false},
		{"month 00", "2025-00-15", false},
		{"day 32", "2025-01-32", false},
		{"day 00", "2025-01-00", false},
		{"non-leap year feb 29", "2025-02-29", false},
		{"april 31", "2025-04-31", false},

		// Edge cases
		{"letters in date", "2025-ab-01", false},
		{"spaces", "2025-01-15 ", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Date(tt.input)
			if got != tt.want {
				t.Errorf("Date(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestDateRange(t *testing.T) {
	tests := []struct {
		name    string
		from    string
		to      string
		wantErr bool
	}{
		// Valid ranges
		{"same day", "2025-01-15", "2025-01-15", false},
		{"one day apart", "2025-01-15", "2025-01-16", false},
		{"one week", "2025-01-01", "2025-01-07", false},
		{"one month", "2025-01-01", "2025-01-31", false},
		{"cross month boundary", "2025-01-15", "2025-02-15", false},
		{"cross year boundary", "2024-12-15", "2025-01-15", false},
		{"exactly 366 days", "2024-01-01", "2025-01-01", false},
		{"neither provided", "", "", false},

		// Invalid - missing one parameter
		{"only from", "2025-01-15", "", true},
		{"only to", "", "2025-01-15", true},

		// Invalid - from after to
		{"from after to same month", "2025-01-20", "2025-01-15", true},
		{"from after to different months", "2025-03-01", "2025-01-15", true},
		{"from after to different years", "2026-01-01", "2025-12-31", true},

		// Invalid - range too large
		{"367 days", "2024-01-01", "2025-01-02", true},
		{"two years", "2024-01-01", "2026-01-01", true},
		{"way too large", "2020-01-01", "2025-01-01", true},

		// Invalid - bad date format
		{"invalid from format", "not-a-date", "2025-01-15", true},
		{"invalid to format", "2025-01-15", "not-a-date", true},
		{"both invalid format", "bad", "also-bad", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DateRange(tt.from, tt.to)
			gotErr := got != ""
			if gotErr != tt.wantErr {
				t.Errorf("DateRange(%q, %q) error = %q, wantErr %v", tt.from, tt.to, got, tt.wantErr)
			}
		})
	}
}

func TestDateRangeErrorMessages(t *testing.T) {
	// Test specific error messages for documentation/debugging
	tests := []struct {
		name        string
		from        string
		to          string
		wantContain string
	}{
		{"only from provided", "2025-01-15", "", "Both 'from' and 'to'"},
		{"only to provided", "", "2025-01-15", "Both 'from' and 'to'"},
		{"from after to", "2025-01-20", "2025-01-15", "'from' date must be before"},
		{"range too large", "2024-01-01", "2025-01-02", "must not exceed"},
		{"invalid from", "bad-date", "2025-01-15", "Invalid 'from'"},
		{"invalid to", "2025-01-15", "bad-date", "Invalid 'to'"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DateRange(tt.from, tt.to)
			if got == "" {
				t.Errorf("DateRange(%q, %q) = empty, want error containing %q", tt.from, tt.to, tt.wantContain)
				return
			}
			if !contains(got, tt.wantContain) {
				t.Errorf("DateRange(%q, %q) = %q, want error containing %q", tt.from, tt.to, got, tt.wantContain)
			}
		})
	}
}

// contains checks if s contains substr (simple substring check)
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		(len(s) > 0 && len(substr) > 0 && searchSubstring(s, substr)))
}

func searchSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestDateRangeYearOverlap(t *testing.T) {
	tests := []struct {
		name    string
		from    string
		to      string
		year    int
		wantErr bool
	}{
		// Valid - both dates in URL year
		{"both in year", "2026-01-01", "2026-06-15", 2026, false},
		{"full year", "2026-01-01", "2026-12-31", 2026, false},

		// Valid - rolling window, from in previous year
		{"from in prev year", "2025-08-08", "2026-02-08", 2026, false},
		{"from dec prev year", "2025-12-01", "2026-01-15", 2026, false},

		// Valid - to overflows into next year
		{"to in next year", "2024-12-15", "2025-01-01", 2024, false},

		// Valid - no dates provided
		{"empty dates", "", "", 2026, false},

		// Invalid - neither date in URL year
		{"both in wrong year", "2024-01-01", "2024-06-01", 2026, true},
		{"both in future year", "2027-01-01", "2027-06-01", 2026, true},

		// Invalid - from too far back (2 years before URL year)
		{"from two years back", "2024-06-01", "2026-02-01", 2026, true},

		// Invalid - to too far forward (2 years after URL year)
		{"to two years forward", "2026-12-01", "2028-01-01", 2026, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DateRangeYearOverlap(tt.from, tt.to, tt.year)
			gotErr := got != ""
			if gotErr != tt.wantErr {
				t.Errorf("DateRangeYearOverlap(%q, %q, %d) = %q, wantErr %v", tt.from, tt.to, tt.year, got, tt.wantErr)
			}
		})
	}
}

// Benchmark tests for performance-sensitive validation
func BenchmarkYear(b *testing.B) {
	for i := 0; i < b.N; i++ {
		Year("2025")
	}
}

func BenchmarkDate(b *testing.B) {
	for i := 0; i < b.N; i++ {
		Date("2025-01-15")
	}
}

func BenchmarkDateRange(b *testing.B) {
	for i := 0; i < b.N; i++ {
		DateRange("2024-12-15", "2025-01-15")
	}
}
