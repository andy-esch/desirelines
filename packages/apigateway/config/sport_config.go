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
	"os"
	"slices"
	"sync"

	"github.com/go-playground/validator/v10"
)

//go:embed sport_types.json
var embeddedSportConfig []byte

// SportCategory is a struct that contains the the configuration/definition
//
//	for a specific sport category
type SportCategory struct {
	DisplayName   string   `json:"display_name" validate:"required"`
	StravaTypes   []string `json:"strava_types" validate:"required,min=1"`
	ExcludedTypes []string `json:"excluded_types"`
	PrimaryMetric string   `json:"primary_metric" validate:"required"`
	Metrics       []string `json:"metrics" validate:"required,min=1"`
	HasDistance   bool     `json:"has_distance"`
	HasElevation  bool     `json:"has_elevation"`
}

// SportConfigData is a config that holds the sport config version and
//
//	the valid sport categories the application can serve
type SportConfigData struct {
	Version         string                   `json:"version" validate:"required"`
	SportCategories map[string]SportCategory `json:"sport_categories" validate:"required,min=1,dive"`
}

// SportConfig contains the data as a SportConfigData struct
type SportConfig struct {
	data SportConfigData
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
		sportConfig, sportConfigErr = loadSportConfigInternal(configPath)
	})
	return sportConfig, sportConfigErr
}

// loadSportConfigInternal is the internal loader (for testing)
func loadSportConfigInternal(configPath string) (*SportConfig, error) {
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

	return &SportConfig{data: configData}, nil
}

// ListSports returns all available sports
func (c *SportConfig) ListSports() []string {
	sports := make([]string, 0, len(c.data.SportCategories))
	for sport := range c.data.SportCategories {
		sports = append(sports, sport)
	}
	return sports
}

// GetCategory returns the general category that a sport belongs to
//
//	E.g., VirtualRide -> cycling, Ride -> cycling, Run -> running, etc.
func (c *SportConfig) GetCategory(sport string) (SportCategory, bool) {
	category, ok := c.data.SportCategories[sport]
	return category, ok
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

// GetRawConfigJSON returns the raw embedded sport config JSON
// Used for serving the config via API endpoint
func GetRawConfigJSON() []byte {
	return embeddedSportConfig
}
