// Package config provides application and sport category configuration for the API Gateway.
//
// The package manages a versioned registry of Desirelines sport categories and
// input vocabularies. Currently only Strava sport_type is supported (e.g., "Ride"
// and "VirtualRide" both map to "cycling").
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
//	sportConfig, err := config.NewSportConfig("testdata/custom_sports.json")
//
// # Using the Configuration
//
// List available sport categories:
//
//	sports := sportConfig.ListSports() // ["cycling", "running", "swimming", ...]
//
// Map between categories and Strava sport types:
//
//	types := sportConfig.GetStravaTypes("cycling")          // ["Ride", "VirtualRide", ...]
//	category := sportConfig.GetCategoryForStravaType("Ride") // "cycling"
//
// An unmapped sport type maps to [UnknownSportCategory] ("other").
//
// # Configuration Schema
//
// The internal version-2.0 registry has this structure:
//
//	{
//	  "version": "2.0",
//	  "sportCategories": {
//	    "cycling": {
//	      "displayName": "Cycling",
//	      "mappings": {
//	        "strava.sport_type": {
//	          "types": ["Ride", "VirtualRide"],
//	          "excludedTypes": []
//	        }
//	      },
//	      "primaryMetric": "distance_meters",
//	      "metrics": ["distance_meters", "elevation_meters", "time_minutes"],
//	      "hasDistance": true,
//	      "hasElevation": true
//	    }
//	  }
//	}
//
// See [SupportedConfigVersions] for supported schema versions.
// [SportConfig.APIJSON] projects this registry to the public version-1.0
// /v1/sports/config response, retaining stravaTypes and excludedTypes.
//
// # Thread Safety
//
// [LoadSportConfig] uses sync.Once internally, so it's safe to call from
// multiple goroutines. The returned [SportConfig] is read-only and thread-safe.
package config
