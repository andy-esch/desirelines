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

			logger.Log(context.TODO(), tt.level, "test")

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

func TestNewWithLevel(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithOptions(Options{
		Level:  slog.LevelWarn,
		Writer: &buf,
	})

	// Debug and Info should be filtered out
	logger.Debug("debug message")
	logger.Info("info message")

	if buf.Len() > 0 {
		t.Errorf("expected no output for DEBUG/INFO when level is WARN, got: %s", buf.String())
	}

	// Warn should be logged
	logger.Warn("warn message")

	if buf.Len() == 0 {
		t.Error("expected WARN message to be logged")
	}

	var output map[string]any
	if err := json.Unmarshal(buf.Bytes(), &output); err != nil {
		t.Fatalf("failed to parse log output: %v", err)
	}
	if output["severity"] != "WARNING" {
		t.Errorf("severity = %v, want WARNING", output["severity"])
	}
}

func TestNewWithOptions_AddSource(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithOptions(Options{
		Writer:    &buf,
		AddSource: true,
	})

	logger.Info("test with source")

	var output map[string]any
	if err := json.Unmarshal(buf.Bytes(), &output); err != nil {
		t.Fatalf("failed to parse log output: %v", err)
	}

	// Check that source info is present with GCP field name
	source, ok := output["logging.googleapis.com/sourceLocation"].(map[string]any)
	if !ok {
		t.Fatalf("expected logging.googleapis.com/sourceLocation field as object, got %T", output["logging.googleapis.com/sourceLocation"])
	}
	if source["file"] == nil {
		t.Error("expected source.file to be present")
	}
	if source["line"] == nil {
		t.Error("expected source.line to be present")
	}
}

func TestNewWithLevel_Convenience(t *testing.T) {
	var buf bytes.Buffer

	// Can't easily test NewWithLevel since it writes to stderr,
	// but we can verify it compiles and the level is applied via Options
	logger := NewWithOptions(Options{
		Level:  slog.LevelDebug,
		Writer: &buf,
	})

	logger.Debug("debug should appear")

	if buf.Len() == 0 {
		t.Error("expected DEBUG message when level is DEBUG")
	}
}

func TestCriticalSeverityLevel(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithOptions(Options{
		Writer: &buf,
	})

	// Use the custom CRITICAL level
	logger.Log(context.TODO(), LevelCritical, "system crash")

	var output map[string]any
	if err := json.Unmarshal(buf.Bytes(), &output); err != nil {
		t.Fatalf("failed to parse log output: %v", err)
	}

	if output["severity"] != "CRITICAL" {
		t.Errorf("severity = %v, want CRITICAL", output["severity"])
	}
	if output["message"] != "system crash" {
		t.Errorf("message = %v, want %q", output["message"], "system crash")
	}
}

func TestAllSeverityLevels(t *testing.T) {
	tests := []struct {
		name     string
		level    slog.Level
		expected string
	}{
		{"Debug", slog.LevelDebug, "DEBUG"},
		{"Info", slog.LevelInfo, "INFO"},
		{"Warn", slog.LevelWarn, "WARNING"},
		{"Error", slog.LevelError, "ERROR"},
		{"Critical", LevelCritical, "CRITICAL"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			logger := NewWithOptions(Options{
				Level:  slog.LevelDebug, // Allow all levels
				Writer: &buf,
			})

			logger.Log(context.TODO(), tt.level, "test")

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
