package dispatcher

import "testing"

// NoOpLogger is a logger that discards all log messages.
// Useful for tests that don't need to capture logs.
type NoOpLogger struct{}

func (NoOpLogger) Info(msg string, args ...any)  {}
func (NoOpLogger) Error(msg string, args ...any) {}
func (NoOpLogger) Warn(msg string, args ...any)  {}
func (NoOpLogger) Debug(msg string, args ...any) {}

// CaptureLogger captures log messages for assertions in tests.
type CaptureLogger struct {
	InfoLogs  []LogEntry
	ErrorLogs []LogEntry
	WarnLogs  []LogEntry
	DebugLogs []LogEntry
}

type LogEntry struct {
	Message string
	Args    []any
}

func NewCaptureLogger() *CaptureLogger {
	return &CaptureLogger{
		InfoLogs:  []LogEntry{},
		ErrorLogs: []LogEntry{},
		WarnLogs:  []LogEntry{},
		DebugLogs: []LogEntry{},
	}
}

func (l *CaptureLogger) Info(msg string, args ...any) {
	l.InfoLogs = append(l.InfoLogs, LogEntry{Message: msg, Args: args})
}

func (l *CaptureLogger) Error(msg string, args ...any) {
	l.ErrorLogs = append(l.ErrorLogs, LogEntry{Message: msg, Args: args})
}

func (l *CaptureLogger) Warn(msg string, args ...any) {
	l.WarnLogs = append(l.WarnLogs, LogEntry{Message: msg, Args: args})
}

func (l *CaptureLogger) Debug(msg string, args ...any) {
	l.DebugLogs = append(l.DebugLogs, LogEntry{Message: msg, Args: args})
}

// Example test demonstrating logger injection
func TestLoggerInjection(t *testing.T) {
	// Create a capture logger to verify log output
	captureLogger := NewCaptureLogger()

	// Create handler with custom logger
	cfg := &Config{}
	mockPub := &MockPublisher{}
	_ = NewHandlerWithPublisher(cfg, mockPub, captureLogger)

	// Now you can assert on captured logs in your tests
	// Example: if len(captureLogger.InfoLogs) > 0 { ... }
}
