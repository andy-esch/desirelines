// Package validate provides shared validation functions for the API Gateway.
//
// # Return Value Patterns
//
// Functions use two patterns based on their error reporting needs:
//
// Bool return (Year, Date): Single failure mode where the caller provides context-specific
// error messages. For example, Date() returns bool so callers can distinguish "Invalid 'from'
// date" from "Invalid 'to' date" - context only available at the call site.
//
// String return (Sport, Cursor, DateRange): Multiple failure modes or specific error details
// that the function can provide. Returns "" on success, error message on failure.
package validate

import (
	"fmt"
	"strconv"
	"time"
)

const (
	// MinValidYear is the earliest year for which activity data can be requested.
	// Set to 2000 to allow pre-Strava historical data imports.
	MinValidYear = 2000

	// MaxValidYear is the latest year for which activity data can be requested.
	// Set to 2050 as a reasonable planning horizon (approximately one generation).
	MaxValidYear = 2050

	// MaxDateRangeDays is the maximum number of days allowed in a date range query.
	MaxDateRangeDays = 366

	// DateFormat is the standard date format for API requests.
	DateFormat = "2006-01-02"

	// MaxSportLength is the maximum length of a sport query parameter.
	// Longest known sport name is ~20 chars, 50 provides buffer.
	MaxSportLength = 50

	// MaxCursorLength is the maximum length of a pagination cursor.
	// Base64-encoded "RFC3339 timestamp|int64 ID" is typically <60 chars.
	MaxCursorLength = 100

	// MaxDateLength is the maximum length of a date string (YYYY-MM-DD = 10).
	MaxDateLength = 10
)

// Year validates that the year string is a 4-digit number within valid bounds.
func Year(s string) bool {
	if len(s) != 4 {
		return false
	}
	year, err := strconv.Atoi(s)
	return err == nil && year >= MinValidYear && year <= MaxValidYear
}

// Sport validates that the sport string is within acceptable length bounds.
// Returns an error message if invalid, empty string if valid.
func Sport(s string) string {
	if len(s) > MaxSportLength {
		return fmt.Sprintf("Sport parameter too long (max %d characters)", MaxSportLength)
	}
	return ""
}

// Cursor validates that the cursor string is within acceptable length bounds.
// Returns an error message if invalid, empty string if valid.
func Cursor(s string) string {
	if len(s) > MaxCursorLength {
		return fmt.Sprintf("Cursor parameter too long (max %d characters)", MaxCursorLength)
	}
	return ""
}

// Date checks if the string is a valid YYYY-MM-DD date.
// Also validates length to prevent oversized inputs.
func Date(s string) bool {
	_, err := parseDate(s)
	return err == nil
}

// parseDate parses a date string and returns the time.Time value.
// Returns an error if the string is too long or not a valid YYYY-MM-DD date.
func parseDate(s string) (time.Time, error) {
	if len(s) > MaxDateLength {
		return time.Time{}, fmt.Errorf("date string too long")
	}
	return time.Parse(DateFormat, s)
}

// DateRangeYearOverlap checks that a validated date range overlaps with the given URL year.
// The range must have at least one endpoint in the URL year; the other may be in an
// adjacent year (previous or next) to support rolling windows:
//
//	GET /activities/2026/source?from=2025-08-08&to=2026-02-08  (from in previous year)
//	GET /activities/2024/metrics?from=2024-12-15&to=2025-01-01 (to in next year)
//
// Assumes fromStr and toStr have already been validated by DateRange.
// Returns an error message if invalid, empty string if valid.
func DateRangeYearOverlap(fromStr, toStr string, year int) string {
	if fromStr == "" || toStr == "" {
		return ""
	}

	fromDate, err := parseDate(fromStr)
	if err != nil {
		panic("programmer error: DateRangeYearOverlap called with invalid 'from' date: " + err.Error())
	}
	toDate, err := parseDate(toStr)
	if err != nil {
		panic("programmer error: DateRangeYearOverlap called with invalid 'to' date: " + err.Error())
	}

	fromYear := fromDate.Year()
	toYear := toDate.Year()

	if fromYear != year && toYear != year {
		return fmt.Sprintf("Date range must overlap with year %d", year)
	}
	if fromYear != year && fromYear != year-1 {
		return fmt.Sprintf("Date range must start in %d or %d", year-1, year)
	}
	if toYear != year && toYear != year+1 {
		return fmt.Sprintf("Date range must end in %d or %d", year, year+1)
	}
	return ""
}

// DateRange validates from/to date parameters.
// Returns an error message if validation fails, empty string if valid.
func DateRange(fromStr, toStr string) string {
	// Either both must be provided, or neither
	if (fromStr != "" && toStr == "") || (fromStr == "" && toStr != "") {
		return "Both 'from' and 'to' must be provided together"
	}

	// If neither provided, no validation needed
	if fromStr == "" && toStr == "" {
		return ""
	}

	// Parse and validate dates (single parse, no redundant validation)
	fromDate, fromErr := parseDate(fromStr)
	if fromErr != nil {
		return "Invalid 'from' date format (expected YYYY-MM-DD)"
	}
	toDate, toErr := parseDate(toStr)
	if toErr != nil {
		return "Invalid 'to' date format (expected YYYY-MM-DD)"
	}

	// Validate: from must be <= to
	if fromDate.After(toDate) {
		return "'from' date must be before or equal to 'to' date"
	}

	// Validate: date range must not exceed 1 year (366 days)
	// Use integer division to avoid floating point precision issues
	days := int(toDate.Sub(fromDate) / (24 * time.Hour))
	if days > MaxDateRangeDays {
		return fmt.Sprintf("Date range must not exceed %d days", MaxDateRangeDays)
	}

	return ""
}
