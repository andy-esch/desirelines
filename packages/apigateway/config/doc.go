// Package config provides application and sport category configuration for the API Gateway.
//
// The package manages a versioned JSON configuration that defines how Strava
// activity types map to display categories (e.g., "Ride" and "VirtualRide"
// both map to "cycling").
//
// # Loading Configuration
//
// In production, configuration is embedded in the binary via go:embed:
//
//	sportConfig, err := config.LoadSportConfig("")
//	if err != nil {
//	    log.Fatal(err)
//	}
//
// For testing, provide a path to a custom config file:
//
//	sportConfig, err := config.LoadSportConfig("testdata/custom_sports.json")
//
// # Using the Configuration
//
// List available sport categories:
//
//	sports := sportConfig.ListSports() // ["cycling", "running", "swimming", ...]
//
// Get category details including metrics and Strava type mappings:
//
//	category, ok := sportConfig.GetCategory("cycling")
//	if ok {
//	    fmt.Println(category.DisplayName)  // "Cycling"
//	    fmt.Println(category.StravaTypes)  // ["Ride", "VirtualRide"]
//	    fmt.Println(category.PrimaryMetric) // "distance"
//	}
//
// # Configuration Schema
//
// The JSON configuration has this structure:
//
//	{
//	  "version": "1.0",
//	  "sport_categories": {
//	    "cycling": {
//	      "display_name": "Cycling",
//	      "strava_types": ["Ride", "VirtualRide"],
//	      "primary_metric": "distance",
//	      "metrics": ["distance", "elevation", "time"],
//	      "has_distance": true,
//	      "has_elevation": true
//	    }
//	  }
//	}
//
// See [SupportedConfigVersions] for supported schema versions.
//
// # Thread Safety
//
// [LoadSportConfig] uses sync.Once internally, so it's safe to call from
// multiple goroutines. The returned [SportConfig] is read-only and thread-safe.
package config
