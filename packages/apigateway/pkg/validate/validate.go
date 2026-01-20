// Package validate provides shared validation functions for the API Gateway.
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
)

// Year validates that the year string is a 4-digit number within valid bounds.
func Year(s string) bool {
	if len(s) != 4 {
		return false
	}
	year, err := strconv.Atoi(s)
	return err == nil && year >= MinValidYear && year <= MaxValidYear
}

// Date checks if the string is a valid YYYY-MM-DD date.
func Date(s string) bool {
	_, err := time.Parse(DateFormat, s)
	return err == nil
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

	// Validate date formats
	if !Date(fromStr) {
		return "Invalid 'from' date format (expected YYYY-MM-DD)"
	}
	if !Date(toStr) {
		return "Invalid 'to' date format (expected YYYY-MM-DD)"
	}

	// Parse dates (format already validated, so errors are unexpected)
	fromDate, fromErr := time.Parse(DateFormat, fromStr)
	if fromErr != nil {
		return "Invalid 'from' date format (expected YYYY-MM-DD)"
	}
	toDate, toErr := time.Parse(DateFormat, toStr)
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
