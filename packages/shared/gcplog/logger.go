// Package gcplog provides structured logging for Go services using slog.
// It configures logging to output JSON format compatible with Google Cloud Logging.
package gcplog

import (
	"io"
	"log/slog"
	"os"
)

// LevelCritical is a custom log level for critical errors (system crashes, etc.).
// This maps to GCP's CRITICAL severity, which is higher than ERROR.
const LevelCritical = slog.Level(12)

// Options configures the GCP logger behavior.
type Options struct {
	// Level sets the minimum log level. Defaults to slog.LevelInfo.
	Level slog.Level
	// Writer sets the output destination. Defaults to os.Stderr.
	Writer io.Writer
	// AddSource includes file:line in log output. Defaults to false.
	AddSource bool
}

// New configures slog for Google Cloud structured logging writing to stderr at INFO level.
func New() *slog.Logger {
	return NewWithOptions(Options{})
}

// NewWithLevel configures slog for Google Cloud structured logging at the specified level.
func NewWithLevel(level slog.Level) *slog.Logger {
	return NewWithOptions(Options{Level: level})
}

// NewWithWriter configures slog for Google Cloud structured logging writing to w.
// Maps slog keys to Google Cloud Logging expected field names and severity levels.
func NewWithWriter(w io.Writer) *slog.Logger {
	return NewWithOptions(Options{Writer: w})
}

// NewWithOptions configures slog for Google Cloud structured logging with full control.
func NewWithOptions(opts Options) *slog.Logger {
	// Apply defaults
	if opts.Writer == nil {
		opts.Writer = os.Stderr
	}

	handler := slog.NewJSONHandler(opts.Writer, &slog.HandlerOptions{
		Level:     opts.Level,
		AddSource: opts.AddSource,
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
					// If type assertion fails, keep original value
					return a
				}
				switch {
				case level >= LevelCritical:
					a.Value = slog.StringValue("CRITICAL")
				case level >= slog.LevelError:
					a.Value = slog.StringValue("ERROR")
				case level >= slog.LevelWarn:
					a.Value = slog.StringValue("WARNING")
				case level >= slog.LevelInfo:
					a.Value = slog.StringValue("INFO")
				default:
					a.Value = slog.StringValue("DEBUG")
				}
			case slog.TimeKey:
				a.Key = "timestamp"
			case slog.SourceKey:
				a.Key = "logging.googleapis.com/sourceLocation"
			}
			return a
		},
	})

	return slog.New(handler)
}
