package gcplog

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"
)

func TestNewWithWriter(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf)

	logger.Info("test message", "key", "value")

	// Parse the output
	var output map[string]any
	if err := json.Unmarshal(buf.Bytes(), &output); err != nil {
		t.Fatalf("failed to parse log output: %v", err)
	}

	// Check GCP field mappings
	if output["message"] != "test message" {
		t.Errorf("message = %v, want %q", output["message"], "test message")
	}
	if output["severity"] != "INFO" {
		t.Errorf("severity = %v, want %q", output["severity"], "INFO")
	}
	if _, ok := output["timestamp"]; !ok {
		t.Error("expected timestamp field")
	}
	if output["key"] != "value" {
		t.Errorf("key = %v, want %q", output["key"], "value")
	}
}

func TestGCPSeverityMapping(t *testing.T) {
	tests := []struct {
		name     string
		level    slog.Level
		expected string
	}{
		{"Debug", slog.LevelDebug, "DEBUG"},
		{"Info", slog.LevelInfo, "INFO"},
		{"Warn", slog.LevelWarn, "WARNING"},
		{"Error", slog.LevelError, "ERROR"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{
				Level: slog.LevelDebug,
				ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
					if groups != nil {
						return a
					}
					if a.Key == slog.LevelKey {
						a.Key = "severity"
						level, ok := a.Value.Any().(slog.Level)
						if !ok {
							return a
						}
						switch {
						case level < slog.LevelInfo:
							a.Value = slog.StringValue("DEBUG")
						case level < slog.LevelWarn:
							a.Value = slog.StringValue("INFO")
						case level < slog.LevelError:
							a.Value = slog.StringValue("WARNING")
						default:
							a.Value = slog.StringValue("ERROR")
						}
					}
					return a
				},
			})
			logger := slog.New(handler)

			logger.Log(nil, tt.level, "test")

			var output map[string]any
			if err := json.Unmarshal(buf.Bytes(), &output); err != nil {
				t.Fatalf("failed to parse log output: %v", err)
			}

			if output["severity"] != tt.expected {
				t.Errorf("severity = %v, want %q", output["severity"], tt.expected)
			}
		})
	}
}

func TestNestedGroupsPreserved(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf)

	// Log with a group
	logger.WithGroup("http").Info("request", "method", "GET", "path", "/test")

	var output map[string]any
	if err := json.Unmarshal(buf.Bytes(), &output); err != nil {
		t.Fatalf("failed to parse log output: %v", err)
	}

	// The group should create a nested object
	http, ok := output["http"].(map[string]any)
	if !ok {
		t.Fatalf("expected http group, got %T", output["http"])
	}
	if http["method"] != "GET" {
		t.Errorf("http.method = %v, want %q", http["method"], "GET")
	}
	if http["path"] != "/test" {
		t.Errorf("http.path = %v, want %q", http["path"], "/test")
	}
}
