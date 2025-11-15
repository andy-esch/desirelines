package dispatcher

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"
)

func TestSetupCloudLogger(t *testing.T) {
	logger := setupCloudLogger()

	if logger == nil {
		t.Fatal("expected logger to be non-nil")
	}

	// Verify logger is enabled for Info level and above
	if !logger.Enabled(nil, slog.LevelInfo) {
		t.Error("expected logger to be enabled for Info level")
	}

	if !logger.Enabled(nil, slog.LevelWarn) {
		t.Error("expected logger to be enabled for Warn level")
	}

	if !logger.Enabled(nil, slog.LevelError) {
		t.Error("expected logger to be enabled for Error level")
	}
}

func TestCloudLogger_OutputFormat(t *testing.T) {
	// Create a buffer to capture log output
	var buf bytes.Buffer
	handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{
		Level: slog.LevelInfo,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			// Don't modify attributes in nested groups
			if groups != nil {
				return a
			}

			// Map slog attribute keys to Google Cloud Logging field names
			switch a.Key {
			case slog.MessageKey:
				a.Key = "message"
			case slog.LevelKey:
				a.Key = "severity"
				// Map slog levels to Google Cloud severity strings
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
			case slog.TimeKey:
				a.Key = "timestamp"
			}
			return a
		},
	})

	logger := slog.New(handler)

	// Log a test message
	logger.Info("test message", "key1", "value1", "key2", 42)

	// Parse the JSON output
	var output map[string]any
	if err := json.Unmarshal(buf.Bytes(), &output); err != nil {
		t.Fatalf("failed to parse log output: %v", err)
	}

	// Verify field mappings
	if msg, ok := output["message"].(string); !ok || msg != "test message" {
		t.Errorf("expected message field with value 'test message', got %v", output["message"])
	}

	if severity, ok := output["severity"].(string); !ok || severity != "INFO" {
		t.Errorf("expected severity field with value 'INFO', got %v", output["severity"])
	}

	if _, ok := output["timestamp"]; !ok {
		t.Error("expected timestamp field to be present")
	}

	// Verify custom attributes are preserved
	if val, ok := output["key1"].(string); !ok || val != "value1" {
		t.Errorf("expected key1=value1, got %v", output["key1"])
	}

	if val, ok := output["key2"].(float64); !ok || val != 42 {
		t.Errorf("expected key2=42, got %v", output["key2"])
	}
}

func TestCloudLogger_SeverityMapping(t *testing.T) {
	tests := []struct {
		name          string
		logFunc       func(*slog.Logger, string)
		expectedLevel string
	}{
		{
			name: "Info level maps to INFO",
			logFunc: func(l *slog.Logger, msg string) {
				l.Info(msg)
			},
			expectedLevel: "INFO",
		},
		{
			name: "Warn level maps to WARNING",
			logFunc: func(l *slog.Logger, msg string) {
				l.Warn(msg)
			},
			expectedLevel: "WARNING",
		},
		{
			name: "Error level maps to ERROR",
			logFunc: func(l *slog.Logger, msg string) {
				l.Error(msg)
			},
			expectedLevel: "ERROR",
		},
		{
			name: "Debug level maps to DEBUG",
			logFunc: func(l *slog.Logger, msg string) {
				l.Debug(msg)
			},
			expectedLevel: "DEBUG",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{
				Level: slog.LevelDebug, // Enable debug to test all levels
				ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
					if groups != nil {
						return a
					}

					switch a.Key {
					case slog.LevelKey:
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
			tt.logFunc(logger, "test message")

			var output map[string]any
			if err := json.Unmarshal(buf.Bytes(), &output); err != nil {
				t.Fatalf("failed to parse log output: %v", err)
			}

			if severity, ok := output["severity"].(string); !ok || severity != tt.expectedLevel {
				t.Errorf("expected severity=%s, got %v", tt.expectedLevel, output["severity"])
			}
		})
	}
}

func TestCloudLogger_NestedGroups(t *testing.T) {
	var buf bytes.Buffer
	handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{
		Level: slog.LevelInfo,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			// Don't modify attributes in nested groups
			if groups != nil {
				return a
			}

			// Map slog attribute keys to Google Cloud Logging field names
			switch a.Key {
			case slog.MessageKey:
				a.Key = "message"
			case slog.LevelKey:
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
			case slog.TimeKey:
				a.Key = "timestamp"
			}
			return a
		},
	})

	logger := slog.New(handler)

	// Log with a group
	logger.WithGroup("request").Info("test message", "method", "GET", "path", "/api/test")

	var output map[string]any
	if err := json.Unmarshal(buf.Bytes(), &output); err != nil {
		t.Fatalf("failed to parse log output: %v", err)
	}

	// Verify top-level fields are mapped
	if _, ok := output["message"]; !ok {
		t.Error("expected message field to be present")
	}

	if _, ok := output["severity"]; !ok {
		t.Error("expected severity field to be present")
	}

	// Verify grouped attributes are preserved
	if request, ok := output["request"].(map[string]any); ok {
		if method, ok := request["method"].(string); !ok || method != "GET" {
			t.Errorf("expected request.method=GET, got %v", request["method"])
		}
		if path, ok := request["path"].(string); !ok || path != "/api/test" {
			t.Errorf("expected request.path=/api/test, got %v", request["path"])
		}
	} else {
		t.Error("expected request group to be present")
	}
}

func TestLogger_PackageVariable(t *testing.T) {
	// Verify the package-level Logger variable is initialized
	if Logger == nil {
		t.Fatal("expected Logger to be initialized")
	}

	// Verify it's a valid logger (can check basic properties)
	if !Logger.Enabled(nil, slog.LevelInfo) {
		t.Error("expected Logger to be enabled for Info level")
	}
}
