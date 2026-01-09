package logger

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"
)

func TestNewWithWriter(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf)

	// Log a message
	logger.Info("test message", "key", "value")

	// Parse JSON output
	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("failed to parse log entry: %v", err)
	}

	// Verify GCP field mappings
	if entry["message"] != "test message" {
		t.Errorf("expected message='test message', got %v", entry["message"])
	}
	if entry["severity"] != "INFO" {
		t.Errorf("expected severity='INFO', got %v", entry["severity"])
	}
	if entry["timestamp"] == nil {
		t.Error("expected timestamp to be present")
	}
	if entry["key"] != "value" {
		t.Errorf("expected key='value', got %v", entry["key"])
	}

	// Verify msg, level, time are removed (replaced)
	if _, ok := entry["msg"]; ok {
		t.Error("expected 'msg' field to be replaced by 'message'")
	}
	if _, ok := entry["level"]; ok {
		t.Error("expected 'level' field to be replaced by 'severity'")
	}
	if _, ok := entry["time"]; ok {
		t.Error("expected 'time' field to be replaced by 'timestamp'")
	}
}

func TestSeverityMapping(t *testing.T) {
	tests := []struct {
		level slog.Level
		want  string
	}{
		{slog.LevelInfo, "INFO"},
		{slog.LevelWarn, "WARNING"},
		{slog.LevelError, "ERROR"},
	}

	for _, tt := range tests {
		var buf bytes.Buffer
		logger := NewWithWriter(&buf)

		logger.Log(context.TODO(), tt.level, "test")

		var entry map[string]any
		if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
			t.Fatalf("failed to parse log entry: %v", err)
		}

		if entry["severity"] != tt.want {
			t.Errorf("level %v: expected severity='%s', got '%v'", tt.level, tt.want, entry["severity"])
		}
	}
}

func TestNestedGroups(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf)

	// Log with a group
	logger.WithGroup("mygroup").Info("test")

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("failed to parse log entry: %v", err)
	}

	// Top level attributes should still be mapped
	if entry["message"] != "test" {
		t.Errorf("expected message='test', got %v", entry["message"])
	}
	if entry["severity"] != "INFO" {
		t.Errorf("expected severity='INFO', got %v", entry["severity"])
	}

	// Attributes inside group should NOT be remapped (ReplaceAttr logic)
	// But note: standard keys (msg, level, time) are top-level, not inside group unless explicitly added.
	// Let's test if we add a key named "msg" inside a group, it shouldn't be renamed.
	buf.Reset()
	logger.WithGroup("nested").Info("test", "msg", "nested_msg")

	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("failed to parse log entry: %v", err)
	}

	nested, entryOk := entry["nested"].(map[string]any)
	if !entryOk {
		t.Fatal("expected nested group")
	}

	// "msg" inside group should stay "msg", not become "message"
	if nested["msg"] != "nested_msg" {
		t.Errorf("expected nested.msg='nested_msg', got %v", nested["msg"])
	}
	// "message" shouldn't exist in nested
	if _, ok := nested["message"]; ok {
		t.Error("unexpected nested.message key")
	}
}
