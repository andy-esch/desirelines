package validate_test

import (
	"fmt"

	"github.com/andy-esch/desirelines/packages/apigateway/pkg/validate"
)

func ExampleParseYear() {
	_, ok := validate.ParseYear("2024")
	fmt.Println(ok) // valid year
	_, ok = validate.ParseYear("1999")
	fmt.Println(ok) // before MinValidYear
	_, ok = validate.ParseYear("2051")
	fmt.Println(ok) // after MaxValidYear
	_, ok = validate.ParseYear("24")
	fmt.Println(ok) // not 4 digits
	// Output:
	// true
	// false
	// false
	// false
}

func ExampleDate() {
	fmt.Println(validate.Date("2024-01-15")) // valid
	fmt.Println(validate.Date("2024-13-01")) // invalid month
	fmt.Println(validate.Date("01-15-2024")) // wrong format
	// Output:
	// true
	// false
	// false
}

func ExampleDateRange() {
	// Valid range
	fmt.Println(validate.DateRange("2024-01-01", "2024-01-31") == "")

	// Missing one date
	fmt.Println(validate.DateRange("2024-01-01", "") != "")

	// From after to
	fmt.Println(validate.DateRange("2024-12-31", "2024-01-01") != "")

	// Range too large (> 366 days)
	fmt.Println(validate.DateRange("2024-01-01", "2025-06-01") != "")
	// Output:
	// true
	// true
	// true
	// true
}

func ExampleSport() {
	// Valid sport (within length limit)
	err := validate.Sport("cycling")
	fmt.Println(err == "")

	// Invalid sport (too long)
	longSport := "this-is-a-very-long-sport-name-that-exceeds-the-maximum-allowed-length"
	err = validate.Sport(longSport)
	fmt.Println(err != "")
	// Output:
	// true
	// true
}

func ExampleCursor() {
	// Valid cursor
	err := validate.Cursor("abc123")
	fmt.Println(err == "")

	// Invalid cursor (too long - over 100 chars)
	longCursor := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	err = validate.Cursor(longCursor)
	fmt.Println(err != "")
	// Output:
	// true
	// true
}

func Example_handlerValidation() {
	// Typical usage pattern in an HTTP handler
	yearParam := "2024"
	fromParam := "2024-01-01"
	toParam := "2024-03-31"
	sportParam := "cycling"

	// Validate all inputs before processing
	if _, ok := validate.ParseYear(yearParam); !ok {
		fmt.Println("invalid year")
		return
	}

	if err := validate.DateRange(fromParam, toParam); err != "" {
		fmt.Println("invalid date range:", err)
		return
	}

	if err := validate.Sport(sportParam); err != "" {
		fmt.Println("invalid sport:", err)
		return
	}

	fmt.Println("all inputs valid")
	// Output: all inputs valid
}
