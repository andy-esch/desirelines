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

	// MaxYearLength is the maximum length of a year string (YYYY = 4).
	MaxYearLength = 4
)

// Year validates that the year string is a 4-digit number within valid bounds.
func Year(s string) bool {
	if len(s) != 4 || len(s) > MaxYearLength {
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
