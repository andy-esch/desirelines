package postgres

import (
	"errors"
	"testing"
)

func TestValidateConnectionString(t *testing.T) {
	tests := []struct {
		name      string
		connStr   string
		wantErr   error
		wantNoErr bool
	}{
		// Valid cases
		{
			name:      "valid with all required params",
			connStr:   "postgresql://user:pass@host/db?sslmode=require&application_name=apigateway",
			wantNoErr: true,
		},
		{
			name:      "valid with application_name only param",
			connStr:   "postgresql://user:pass@host/db?application_name=my-service",
			wantNoErr: true,
		},
		{
			name:      "valid with application_name first",
			connStr:   "postgresql://user:pass@host/db?application_name=svc&sslmode=require",
			wantNoErr: true,
		},
		{
			name:      "valid with special chars in application_name",
			connStr:   "postgresql://user:pass@host/db?application_name=my-service_v2",
			wantNoErr: true,
		},
		{
			name:      "valid with port number",
			connStr:   "postgresql://user:pass@host:5432/db?application_name=test",
			wantNoErr: true,
		},
		// Missing application_name
		{
			name:    "missing application_name",
			connStr: "postgresql://user:pass@host/db?sslmode=require",
			wantErr: ErrMissingApplicationName,
		},
		{
			name:    "empty connection string",
			connStr: "",
			wantErr: ErrInvalidScheme, // Empty string has no scheme
		},
		{
			name:    "no query params",
			connStr: "postgresql://user:pass@host/db",
			wantErr: ErrMissingApplicationName,
		},
		// Invalid scheme
		{
			name:    "wrong scheme mysql",
			connStr: "mysql://user:pass@host/db?application_name=test",
			wantErr: ErrInvalidScheme,
		},
		{
			name:    "wrong scheme postgres (missing ql)",
			connStr: "postgres://user:pass@host/db?application_name=test",
			wantErr: ErrInvalidScheme,
		},
		{
			name:    "sqlalchemy dialect prefix rejected",
			connStr: "postgresql+psycopg://user:pass@host/db?application_name=test",
			wantErr: ErrInvalidScheme,
		},
		{
			name:    "http scheme rejected",
			connStr: "http://user:pass@host/db?application_name=test",
			wantErr: ErrInvalidScheme,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateConnectionString(tt.connStr)

			if tt.wantNoErr {
				if err != nil {
					t.Errorf("validateConnectionString() error = %v, want no error", err)
				}
				return
			}

			if err == nil {
				t.Errorf("validateConnectionString() error = nil, want error")
				return
			}

			if tt.wantErr != nil && !errors.Is(err, tt.wantErr) {
				t.Errorf("validateConnectionString() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

// TestValidateApplicationName tests the deprecated alias still works
func TestValidateApplicationName(t *testing.T) {
	// Just verify the alias calls through correctly
	err := validateApplicationName("postgresql://user@host/db?application_name=test")
	if err != nil {
		t.Errorf("validateApplicationName() error = %v, want no error", err)
	}

	err = validateApplicationName("postgresql://user@host/db")
	if !errors.Is(err, ErrMissingApplicationName) {
		t.Errorf("validateApplicationName() error = %v, want ErrMissingApplicationName", err)
	}
}

func TestSentinelErrors(t *testing.T) {
	t.Run("ErrMissingApplicationName is sentinel", func(t *testing.T) {
		err := validateConnectionString("postgresql://user@host/db")
		if !errors.Is(err, ErrMissingApplicationName) {
			t.Errorf("error should wrap ErrMissingApplicationName, got %v", err)
		}
	})

	t.Run("ErrInvalidScheme is sentinel with context", func(t *testing.T) {
		err := validateConnectionString("mysql://user@host/db?application_name=test")
		if !errors.Is(err, ErrInvalidScheme) {
			t.Errorf("error should wrap ErrInvalidScheme, got %v", err)
		}
		// Error message should include the actual scheme
		if err.Error() == ErrInvalidScheme.Error() {
			t.Error("error should include actual scheme in message")
		}
	})
}
