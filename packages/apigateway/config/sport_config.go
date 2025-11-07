package config

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/go-playground/validator/v10"
)

type SportCategory struct {
	DisplayName   string   `json:"display_name" validate:"required"`
	StravaTypes   []string `json:"strava_types" validate:"required,min=1"`
	ExcludedTypes []string `json:"excluded_types"`
	PrimaryMetric string   `json:"primary_metric" validate:"required"`
	Metrics       []string `json:"metrics" validate:"required,min=1"`
	HasDistance   bool     `json:"has_distance"`
	HasElevation  bool     `json:"has_elevation"`
}

type SportConfigData struct {
	Version         string                   `json:"version" validate:"required"`
	SportCategories map[string]SportCategory `json:"sport_categories" validate:"required,min=1,dive"`
}

type SportConfig struct {
	data SportConfigData
}

var (
	sportConfig     *SportConfig
	sportConfigOnce sync.Once
	validate        = validator.New()
)

// Update when code supports new versions
var SupportedConfigVersions = []string{"1.0"}

func LoadSportConfig(configPath string) (*SportConfig, error) {
	var err error
	sportConfigOnce.Do(func() {
		sportConfig, err = loadSportConfigInternal(configPath)
	})
	return sportConfig, err
}

// loadSportConfigInternal is the internal loader (for testing)
func loadSportConfigInternal(configPath string) (*SportConfig, error) {
	// #nosec G304 - configPath is a known configuration file path
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read sport config: %w", err)
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
	if !contains(SupportedConfigVersions, configData.Version) {
		return nil, fmt.Errorf(
			"unsupported sport config version: %s (supports: %v). "+
				"Update application code or rollback config version",
			configData.Version, SupportedConfigVersions,
		)
	}

	return &SportConfig{data: configData}, nil
}

func GetSportConfig() *SportConfig {
	return sportConfig
}

func (c *SportConfig) ListSports() []string {
	sports := make([]string, 0, len(c.data.SportCategories))
	for sport := range c.data.SportCategories {
		sports = append(sports, sport)
	}
	return sports
}

func (c *SportConfig) GetCategory(sport string) (SportCategory, bool) {
	category, ok := c.data.SportCategories[sport]
	return category, ok
}

func (c *SportConfig) ValidateSport(sport string) bool {
	_, ok := c.data.SportCategories[sport]
	return ok
}

func contains(slice []string, value string) bool {
	for _, item := range slice {
		if item == value {
			return true
		}
	}
	return false
}
