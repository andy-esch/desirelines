// Package validate provides input validation functions for API Gateway request parameters.
//
// All validation functions are designed to be safe against oversized inputs,
// enforcing maximum lengths before parsing to prevent resource exhaustion.
//
// # Date Validation
//
// Dates must be in YYYY-MM-DD format:
//
//	if !validate.Date("2024-01-15") {
//	    // handle invalid date
//	}
//
// Date ranges require both from and to, and are limited to [MaxDateRangeDays]:
//
//	if err := validate.DateRange("2024-01-01", "2024-12-31"); err != "" {
//	    // handle validation error message
//	}
//
// # Year Validation
//
// Years must be 4-digit numbers within [MinValidYear] to [MaxValidYear]:
//
//	if !validate.Year("2024") {
//	    // handle invalid year
//	}
//
// # String Length Validation
//
// Sport and cursor parameters are validated for maximum length only,
// returning error messages suitable for API responses:
//
//	if err := validate.Sport(sportParam); err != "" {
//	    http.Error(w, err, http.StatusBadRequest)
//	    return
//	}
//
// # Constants
//
// The package exports bounds constants for use in documentation and tests:
//
//   - [MinValidYear], [MaxValidYear]: Valid year range (2000-2050)
//   - [MaxDateRangeDays]: Maximum days in a date range query (366)
//   - [MaxSportLength], [MaxCursorLength]: Input length limits
//   - [DateFormat]: Expected date format string ("2006-01-02")
package validate
