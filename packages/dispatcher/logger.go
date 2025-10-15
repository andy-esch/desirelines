package dispatcher

import (
	"log/slog"
	"os"
)

// setupCloudLogger configures slog for Google Cloud structured logging.
// Maps slog keys to Google Cloud Logging expected field names and severity levels.
func setupCloudLogger() *slog.Logger {
	handler := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
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
				level := a.Value.Any().(slog.Level)
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

	return slog.New(handler)
}

// Logger is the package-level structured logger for Cloud Functions
var Logger = setupCloudLogger()
