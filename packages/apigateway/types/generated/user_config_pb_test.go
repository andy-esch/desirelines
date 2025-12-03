package generated

import (
	"encoding/json"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
)

func TestUserConfig_WithGoals(t *testing.T) {
	config := &UserConfig{
		UserId:        "user123",
		SchemaVersion: "1.0",
		LastUpdated:   "2024-11-01T12:00:00Z",
		Goals: map[string]*SportGoalsForYear{
			"2024": {
				Sports: map[string]*GoalsForYear{
					"cycling": {
						Goals: []*Goal{
							{
								Id:    "goal-1",
								Value: 1000,
								Label: "Ride 1000 miles",
							},
							{
								Id:    "goal-2",
								Value: 2000,
								Label: "Stretch goal",
							},
						},
					},
				},
			},
		},
	}

	jsonBytes, marshalErr := protojson.Marshal(config)
	if marshalErr != nil {
		t.Fatalf("Failed to marshal: %v", marshalErr)
	}

	var data map[string]any
	if unmarshalErr := json.Unmarshal(jsonBytes, &data); unmarshalErr != nil {
		t.Fatalf("Failed to unmarshal: %v", unmarshalErr)
	}

	if data["userId"] != "user123" {
		t.Errorf("Expected userId user123, got %v", data["userId"])
	}

	goals, ok := data["goals"].(map[string]any)["2024"].(map[string]any)["sports"].(map[string]any)["cycling"].(map[string]any)["goals"].([]any)
	if !ok {
		t.Fatal("goals is not a []any")
	}
	if len(goals) != 2 {
		t.Errorf("Expected 2 goals, got %d", len(goals))
	}
}

func TestUserConfig_WithAnnotations(t *testing.T) {
	config := &UserConfig{
		UserId: "user456",
		Annotations: map[string]*AnnotationsForYear{
			"2024": {
				Annotations: []*Annotation{
					{
						Id:               "ann-1",
						StartDate:        "2024-07-14",
						Label:            "Race Day",
						Description:      "Big Sur Marathon",
						Type:             AnnotationType_ANNOTATION_TYPE_EVENT,
						StravaActivityId: "123456",
					},
					{
						Id:        "ann-2",
						StartDate: "2024-01-01",
						EndDate:   "2024-01-31",
						Label:     "Training Block",
						Type:      AnnotationType_ANNOTATION_TYPE_PERIOD,
					},
					{
						Id:        "ann-3",
						StartDate: "2024-06-01",
						Label:     "Recovery Week",
						Type:      AnnotationType_ANNOTATION_TYPE_NOTE,
					},
				},
			},
		},
	}

	jsonBytes, marshalErr := protojson.Marshal(config)
	if marshalErr != nil {
		t.Fatalf("Failed to marshal: %v", marshalErr)
	}

	var data map[string]any
	if err := json.Unmarshal(jsonBytes, &data); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	annotations, ok := data["annotations"].(map[string]any)["2024"].(map[string]any)["annotations"].([]any)
	if !ok {
		t.Fatal("annotations is not a []any")
	}
	if len(annotations) != 3 {
		t.Errorf("Expected 3 annotations, got %d", len(annotations))
	}

	ann1, ok := annotations[0].(map[string]any)
	if !ok {
		t.Fatal("ann1 is not a map[string]any")
	}
	if ann1["type"] != "ANNOTATION_TYPE_EVENT" {
		t.Errorf("Expected EVENT type, got %v", ann1["type"])
	}
	if ann1["stravaActivityId"] != "123456" {
		t.Errorf("Expected strava ID 123456, got %v", ann1["stravaActivityId"])
	}
}

func TestUserConfig_WithPreferences(t *testing.T) {
	config := &UserConfig{
		UserId: "user789",
		Preferences: &Preferences{
			Theme:       "dark",
			DefaultYear: 2024,
			ChartDefaults: &ChartDefaults{
				ShowAverage: true,
				ShowGoals:   false,
			},
		},
	}

	jsonBytes, err := protojson.Marshal(config)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	var data map[string]any
	if unmarshalErr := json.Unmarshal(jsonBytes, &data); unmarshalErr != nil {
		t.Fatalf("Failed to unmarshal: %v", unmarshalErr)
	}

	prefs, ok := data["preferences"].(map[string]any)
	if !ok {
		t.Fatal("prefs is not map[str]any")
	}
	if prefs["theme"] != "dark" {
		t.Errorf("Expected theme dark, got %v", prefs["theme"])
	}
	defaultYear, ok := prefs["defaultYear"].(float64)
	if !ok {
		t.Fatal("defaultYear cannot be cast to float")
	}
	if defaultYear != 2024 {
		t.Errorf("Expected year 2024, got %v", prefs["defaultYear"])
	}

	chartDefaults, ok := prefs["chartDefaults"].(map[string]any)
	if !ok {
		t.Fatal("chartDefaults is not map[str]any")
	}
	if chartDefaults["showAverage"] != true {
		t.Error("Expected showAverage true")
	}
}

func TestUserConfig_WithMetadata(t *testing.T) {
	config := &UserConfig{
		UserId: "user999",
		Metadata: &Metadata{
			CreatedAt:        "2024-01-01T00:00:00Z",
			LastSyncedDevice: "chrome-desktop",
			ConfigTypes:      []string{"goals", "annotations", "preferences"},
		},
	}

	jsonBytes, err := protojson.Marshal(config)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	var data map[string]any
	if unmarshalErr := json.Unmarshal(jsonBytes, &data); unmarshalErr != nil {
		t.Fatalf("Failed to unmarshal: %v", unmarshalErr)
	}

	metadata, ok := data["metadata"].(map[string]any)
	if !ok {
		t.Fatal("metadata is not a map[str]any")
	}
	if metadata["createdAt"] != "2024-01-01T00:00:00Z" {
		t.Errorf("Unexpected createdAt: %v", metadata["createdAt"])
	}
	if metadata["lastSyncedDevice"] != "chrome-desktop" {
		t.Errorf("Unexpected device: %v", metadata["lastSyncedDevice"])
	}

	configTypes, ok := metadata["configTypes"].([]any)
	if !ok {
		t.Fatal("configTypes is not a []any")
	}
	if len(configTypes) != 3 {
		t.Errorf("Expected 3 config types, got %d", len(configTypes))
	}
}

func TestUserConfig_Complete(t *testing.T) {
	config := &UserConfig{
		UserId:        "complete-user",
		SchemaVersion: "1.0",
		LastUpdated:   "2024-11-01T12:00:00Z",
		Goals: map[string]*SportGoalsForYear{
			"2024": {
				Sports: map[string]*GoalsForYear{
					"cycling": {
						Goals: []*Goal{{Id: "g1", Value: 1500, Label: "Annual goal"}},
					},
				},
			},
		},
		Annotations: map[string]*AnnotationsForYear{
			"2024": {
				Annotations: []*Annotation{
					{
						Id:        "ann-1",
						StartDate: "2024-06-01",
						Label:     "Summer training",
						Type:      AnnotationType_ANNOTATION_TYPE_PERIOD,
					},
				},
			},
		},
		Preferences: &Preferences{
			Theme:       "light",
			DefaultYear: 2024,
		},
		Metadata: &Metadata{
			CreatedAt: "2024-01-01T00:00:00Z",
		},
	}

	jsonBytes, marshalErr := protojson.Marshal(config)
	if marshalErr != nil {
		t.Fatalf("Failed to marshal: %v", marshalErr)
	}

	var data map[string]any
	if err := json.Unmarshal(jsonBytes, &data); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	// Verify all sections present
	if _, ok := data["goals"]; !ok {
		t.Error("Missing goals")
	}
	if _, ok := data["annotations"]; !ok {
		t.Error("Missing annotations")
	}
	if _, ok := data["preferences"]; !ok {
		t.Error("Missing preferences")
	}
	if _, ok := data["metadata"]; !ok {
		t.Error("Missing metadata")
	}
}

func TestAnnotationType_Enum(t *testing.T) {
	tests := []struct {
		name     string
		annType  AnnotationType
		expected string
	}{
		{"event", AnnotationType_ANNOTATION_TYPE_EVENT, "ANNOTATION_TYPE_EVENT"},
		{"period", AnnotationType_ANNOTATION_TYPE_PERIOD, "ANNOTATION_TYPE_PERIOD"},
		{"note", AnnotationType_ANNOTATION_TYPE_NOTE, "ANNOTATION_TYPE_NOTE"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ann := &Annotation{
				Id:   "test",
				Type: tt.annType,
			}

			jsonBytes, err := protojson.Marshal(ann)
			if err != nil {
				t.Fatalf("Failed to marshal: %v", err)
			}
			var data map[string]any
			if unmarshalErr := json.Unmarshal(jsonBytes, &data); unmarshalErr != nil {
				t.Fatalf("Failed to unmarshal: %v", err)
			}

			if data["type"] != tt.expected {
				t.Errorf("Expected %s, got %v", tt.expected, data["type"])
			}
		})
	}
}

func TestUserConfig_Deserialization(t *testing.T) {
	jsonData := `{
		"userId": "parse-test",
		"schemaVersion": "1.0",
		"goals": {
			"2024": {
				"sports": {
					"cycling": {
						"goals": [
							{"id": "g1", "value": 1000, "label": "Goal 1"}
						]
					}
				}
			}
		},
		"preferences": {
			"theme": "dark",
			"defaultYear": 2024
		}
	}`

	config := &UserConfig{}
	if err := protojson.Unmarshal([]byte(jsonData), config); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if config.UserId != "parse-test" {
		t.Errorf("Expected userId parse-test, got %s", config.UserId)
	}
	if config.SchemaVersion != "1.0" {
		t.Errorf("Expected version 1.0, got %s", config.SchemaVersion)
	}
	if len(config.Goals["2024"].Sports["cycling"].Goals) != 1 {
		t.Errorf("Expected 1 goal, got %d", len(config.Goals["2024"].Sports["cycling"].Goals))
	}
	if config.Goals["2024"].Sports["cycling"].Goals[0].Value != 1000 {
		t.Errorf("Expected goal value 1000, got %d", config.Goals["2024"].Sports["cycling"].Goals[0].Value)
	}
	if config.Preferences.Theme != "dark" {
		t.Errorf("Expected theme dark, got %s", config.Preferences.Theme)
	}
}
