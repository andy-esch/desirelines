package gcplog

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"sync"
)

// NewNoOpLogger returns a logger that discards all output.
// Useful for tests to avoid polluting test output.
func NewNoOpLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// CapturedLog represents a single log entry captured by the CaptureLogger.
type CapturedLog struct {
	Level   slog.Level
	Message string
	Attrs   map[string]any
}

// LogCaptureHandler is a slog.Handler that stores logs in memory for assertion.
type LogCaptureHandler struct {
	mu   sync.Mutex
	logs []CapturedLog
}

// Enabled always returns true for test capture.
func (h *LogCaptureHandler) Enabled(_ context.Context, _ slog.Level) bool {
	return true
}

// Handle stores the log record.
func (h *LogCaptureHandler) Handle(_ context.Context, r slog.Record) error { //nolint:gocritic // hugeParam: slog.Handler interface requires value receiver
	h.mu.Lock()
	defer h.mu.Unlock()

	attrs := make(map[string]any)
	r.Attrs(func(a slog.Attr) bool {
		attrs[a.Key] = flattenAttr(a)
		return true
	})

	h.logs = append(h.logs, CapturedLog{
		Level:   r.Level,
		Message: r.Message,
		Attrs:   attrs,
	})
	return nil
}

// flattenAttr converts an attribute to its value, handling groups specially.
func flattenAttr(a slog.Attr) any {
	if a.Value.Kind() == slog.KindGroup {
		group := make(map[string]any)
		for _, ga := range a.Value.Group() {
			group[ga.Key] = flattenAttr(ga)
		}
		return group
	}
	return a.Value.Any()
}

// WithAttrs returns a new handler with attributes (not implemented for simple capture).
func (h *LogCaptureHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return h
}

// WithGroup returns a new handler with group (not implemented for simple capture).
func (h *LogCaptureHandler) WithGroup(name string) slog.Handler {
	return h
}

// NewCaptureLogger returns a logger and a handler that captures logs for inspection.
func NewCaptureLogger() (*slog.Logger, *LogCaptureHandler) {
	handler := &LogCaptureHandler{}
	return slog.New(handler), handler
}

// Logs returns a copy of captured logs in a thread-safe way.
func (h *LogCaptureHandler) Logs() []CapturedLog {
	h.mu.Lock()
	defer h.mu.Unlock()
	// Return a copy to avoid races
	logs := make([]CapturedLog, len(h.logs))
	copy(logs, h.logs)
	return logs
}

// NewBufferLogger returns a logger that writes to a buffer, useful for checking output string.
func NewBufferLogger() (*slog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	return logger, &buf
}
