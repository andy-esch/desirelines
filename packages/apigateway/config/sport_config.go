// Package config provides sport configuration management for the API Gateway.
//
// # Design: Singleton Loading + Dependency Injection for Usage
//
// This package uses a two-layer approach:
//
//  1. Loading layer: LoadSportConfig() uses sync.Once to load config exactly once.
//     This is appropriate because sport config is application-wide, immutable after
//     startup, and expensive to parse/validate.
//
//  2. Usage layer: Handlers and business logic receive *SportConfig via constructor
//     injection (see activities.NewHandler). This enables proper testing and avoids
//     hidden dependencies in business logic.
//
// For testing:
//   - Unit tests that need custom configs use loadSportConfigInternal() directly
//   - Handler tests create configs and inject them via constructors
//   - The sync.Once doesn't affect test isolation because handlers use injected instances
package config

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"sync"

	"github.com/go-playground/validator/v10"
)

// UnknownSportCategory is the fallback category returned when a Strava sport_type
// has no explicit mapping in sport_types.json. The catch-all keeps unmapped
// activities visible in the UI ("Other") instead of silently dropping them.
//
// Operators are alerted via the "Unknown Strava sport_type detected" log-based
// metric (see terraform/modules/desirelines/alerts.tf). When the alert fires,
// add the upstream sport to schemas/sports/sport_types.json so it lands in its
// proper category.
const UnknownSportCategory = "other"

// unknownSportLogMessage is the human-readable log message for unmapped
// sport_type values. It is NO LONGER what the metric keys off (see
// unknownSportLogEvent), so it can be reworded freely.
const unknownSportLogMessage = "Unknown Strava sport_type detected"

// unknownSportLogEvent is the stable structured "event" field the GCP
// log-based metric (terraform/modules/desirelines/monitoring.tf) filters on:
// jsonPayload.event="unknown_sport_type". Keying the metric on this machine
// field instead of the prose message means a reworded message can't silently
// break the alert. It is a MONITORING CONTRACT shared across two runtimes —
// keep byte-identical with the Python emitter (UNKNOWN_SPORT_LOG_EVENT) and the
// terraform filter; pinned by TestGetCategoryForStravaType_UnknownLogsWarning.
const unknownSportLogEvent = "unknown_sport_type"

//go:embed sport_types.json
var embeddedSportConfig []byte

// SportCategory defines a sport category and its mapping to Strava's data model.
//
// # Strava type vs sport_type
//
// Strava's API has two activity classification fields:
//   - type: broad/deprecated category (e.g., "Workout" covers yoga, weight training, HIIT, etc.)
//   - sport_type: specific activity kind (e.g., "Yoga", "WeightTraining", "HIIT")
//
// StravaTypes contains sport_type values (the specific ones), NOT type values.
// The database stores both: column 'type' = Strava type, column 'sport' = Strava sport_type.
// All filtering queries must use the 'sport' column to match against StravaTypes.
type SportCategory struct {
	DisplayName string `json:"displayName" validate:"required"`
	// StravaTypes lists Strava sport_type values belonging to this category.
	// Example: cycling = ["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", ...]
	// These match the DB 'sport' column, NOT the 'type' column.
	StravaTypes   []string `json:"stravaTypes" validate:"required,min=1"`
	ExcludedTypes []string `json:"excludedTypes"`
	PrimaryMetric string   `json:"primaryMetric" validate:"required"`
	Metrics       []string `json:"metrics" validate:"required,min=1"`
	HasDistance   bool     `json:"hasDistance"`
	HasElevation  bool     `json:"hasElevation"`
	// DangerPace is the optional sustainable-pace limit used by the frontend's
	// "danger zone" rendering. Loaded and passed through verbatim; the apigateway
	// does not interpret it.
	DangerPace *DangerPace `json:"dangerPace,omitempty"`
	// GoalDefaults is optional per-sport goal tuning (increment / rounding /
	// default / chart intervals) used by the frontend's metric-config layer.
	// Loaded and passed through verbatim; the apigateway does not interpret it.
	GoalDefaults *GoalDefaults `json:"goalDefaults,omitempty"`
}

// DangerPace expresses a daily pace ceiling in human-readable units. The web
// client converts it to the user's preferred display unit before comparing.
type DangerPace struct {
	ValuePerDay float64 `json:"valuePerDay" validate:"required"`
	Unit        string  `json:"unit" validate:"required"`
	// WarnAtFraction is the optional fraction of the threshold at which the
	// frontend's pacing chart starts showing the "danger zone" overlay
	// (defaults to 0.75 when omitted). Loaded and passed through verbatim, but
	// range-validated at startup so a misconfigured registry fails fast.
	WarnAtFraction *float64 `json:"warnAtFraction,omitempty" validate:"omitempty,gte=0,lte=1"`
}

// GoalDefaults is optional per-sport goal tuning consumed by the frontend. Each
// field is optional and inherits the base metric config when omitted. Loaded
// and passed through verbatim; the apigateway does not interpret it.
type GoalDefaults struct {
	Increment      *float64        `json:"increment,omitempty"`
	Rounding       *float64        `json:"rounding,omitempty"`
	DefaultValue   *float64        `json:"defaultValue,omitempty"`
	ChartIntervals []ChartInterval `json:"chartIntervals,omitempty"`
}

// ChartInterval is one Y-axis tick threshold. A nil Max marks the catch-all
// top bucket (JSON has no Infinity; the frontend restores it).
type ChartInterval struct {
	Max      *float64 `json:"max,omitempty"`
	Interval float64  `json:"interval"`
}

// SportConfigData is a config that holds the sport config version and
//
//	the valid sport categories the application can serve
type SportConfigData struct {
	Version         string                   `json:"version" validate:"required"`
	SportCategories map[string]SportCategory `json:"sportCategories" validate:"required,min=1,dive"`
}

// SportConfig contains the data as a SportConfigData struct
type SportConfig struct {
	data SportConfigData
	// reverseMap maps Strava sport_type values to category names.
	// Built at load time for O(1) lookups. E.g., "Ride" → "cycling".
	reverseMap map[string]string
	// rawJSON stores the original JSON bytes used to create this config.
	// Used for serving the config via API endpoint.
	rawJSON []byte
	// unknownSeen deduplicates the WARNING log emitted by
	// GetCategoryForStravaType so a single unmapped sport_type doesn't spam
	// logs across a request burst. Cleared with the process — Cloud Run
	// recycling naturally re-arms the dedup, which is exactly what the
	// log-based alert wants (one fresh sighting per restart).
	unknownSeen sync.Map
}

// Package-level state for singleton loading pattern.
// These are only used by LoadSportConfig() - business logic receives *SportConfig
// via dependency injection and doesn't access these directly.
var (
	sportConfig     *SportConfig
	sportConfigErr  error
	sportConfigOnce sync.Once
	validate        = validator.New()
)

// SupportedConfigVersions is a list of supported versions
var SupportedConfigVersions = []string{"1.0"}

// LoadSportConfig loads available application SportConfig
// Uses sync.Once to ensure it's only loaded once in production
func LoadSportConfig(configPath string) (*SportConfig, error) {
	sportConfigOnce.Do(func() {
		sportConfig, sportConfigErr = NewSportConfig(configPath)
	})
	return sportConfig, sportConfigErr
}

// NewSportConfig creates a new SportConfig instance from a file or embedded default.
// Exposed for testing to allow creating isolated config instances.
func NewSportConfig(configPath string) (*SportConfig, error) {
	var data []byte
	var err error

	// If path provided, use it (for testing with custom configs)
	// Otherwise, use embedded config
	if configPath != "" {
		// Use file system path (for development/testing with custom configs)
		// #nosec G304 - configPath is a known configuration file path
		data, err = os.ReadFile(configPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read sport config: %w", err)
		}
	} else {
		// Use embedded config (production default)
		if len(embeddedSportConfig) == 0 {
			return nil, fmt.Errorf("embedded sport config not available and no path provided")
		}
		data = embeddedSportConfig
	}

	var configData SportConfigData
	err = json.Unmarshal(data, &configData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse sport config: %w", err)
	}

	// Validate schema with struct tags
	err = validate.Struct(configData)
	if err != nil {
		return nil, fmt.Errorf("invalid sport config schema: %w", err)
	}

	// Validate version (fail fast)
	if !slices.Contains(SupportedConfigVersions, configData.Version) {
		return nil, fmt.Errorf(
			"unsupported sport config version: %s (supports: %v). "+
				"Update application code or rollback config version",
			configData.Version, SupportedConfigVersions,
		)
	}

	// Build reverse lookup map: Strava sport_type → category name.
	// Fail fast if a sport_type appears under more than one category: the map
	// range order is randomized per process, so a collision would otherwise
	// resolve to whichever category was visited last — silently miscategorizing
	// and changing the answer on every restart.
	reverseMap := make(map[string]string)
	for categoryName := range configData.SportCategories {
		// Index the map for just the slice we need rather than ranging the
		// value: `k, v := range` would copy the whole SportCategory struct each
		// iteration (gocritic rangeValCopy) now that it carries optional config.
		stravaTypes := configData.SportCategories[categoryName].StravaTypes
		for _, stravaType := range stravaTypes {
			if existing, dup := reverseMap[stravaType]; dup {
				return nil, fmt.Errorf(
					"invalid sport config: sport_type %q maps to multiple categories "+
						"(%q and %q); each sport_type must belong to exactly one category",
					stravaType, existing, categoryName,
				)
			}
			reverseMap[stravaType] = categoryName
		}
	}

	return &SportConfig{data: configData, reverseMap: reverseMap, rawJSON: data}, nil
}

// ListSports returns all available sports
func (c *SportConfig) ListSports() []string {
	sports := make([]string, 0, len(c.data.SportCategories))
	for sport := range c.data.SportCategories {
		sports = append(sports, sport)
	}
	return sports
}

// GetCategory returns the SportCategory config for a category name.
// For example, GetCategory("cycling") returns the cycling config with its Strava types, metrics, etc.
// Returns false if the category doesn't exist.
func (c *SportConfig) GetCategory(category string) (SportCategory, bool) {
	cat, ok := c.data.SportCategories[category]
	return cat, ok
}

// ValidateSport ensures that an input sport is a sport that
//
//	can be served
func (c *SportConfig) ValidateSport(sport string) bool {
	_, ok := c.data.SportCategories[sport]
	return ok
}

// GetStravaTypes returns the Strava sport_type values that map to a category.
// For example, "cycling" returns ["Ride", "VirtualRide"].
// Returns nil if the category doesn't exist.
func (c *SportConfig) GetStravaTypes(category string) []string {
	cat, ok := c.data.SportCategories[category]
	if !ok {
		return nil
	}
	return cat.StravaTypes
}

// GetCategoryForStravaType returns the category name for a Strava sport_type value.
// For example, "Ride" returns "cycling", "TrailRun" returns "running".
//
// When the sport_type has no mapping (e.g., Strava added a new SportType enum
// value upstream that we haven't registered yet), it returns
// [UnknownSportCategory] ("other") and emits a structured WARNING log so the
// log-based metric "${var.project_name}_${var.environment}_unknown_sport_type"
// can fire an alert. The warning is deduplicated per-process (sync.Map) to
// avoid log spam from request bursts referencing the same unmapped type.
func (c *SportConfig) GetCategoryForStravaType(stravaType string) string {
	if category, ok := c.reverseMap[stravaType]; ok {
		return category
	}
	if stravaType == "" {
		// Empty input is not a real Strava sport_type — bucket it as "other"
		// without logging (would be noisy if a column ever lands NULL).
		return UnknownSportCategory
	}
	if _, loaded := c.unknownSeen.LoadOrStore(stravaType, struct{}{}); !loaded {
		slog.Default().Warn(unknownSportLogMessage,
			"event", unknownSportLogEvent,
			"unmapped_sport_type", stravaType,
			"fallback_category", UnknownSportCategory,
		)
	}
	return UnknownSportCategory
}

// RawJSON returns the raw sport config JSON bytes.
// Used for serving the config via API endpoint.
func (c *SportConfig) RawJSON() []byte {
	return c.rawJSON
}
