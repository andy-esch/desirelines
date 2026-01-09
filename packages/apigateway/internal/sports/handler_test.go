package sports

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/pkg/apierrors"
)

func TestHandler_HandleConfig(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tests := []struct {
		name           string
		mockConfig     func() []byte
		expectedStatus int
		expectedBody   string
		checkError     bool
	}{
		{
			name: "Valid config",
			mockConfig: func() []byte {
				return []byte(`{"sports": ["cycling", "running"]}`)
			},
			expectedStatus: http.StatusOK,
			expectedBody:   `{"sports": ["cycling", "running"]}`,
		},
		{
			name: "Empty config",
			mockConfig: func() []byte {
				return []byte{}
			},
			expectedStatus: http.StatusInternalServerError,
			checkError:     true,
		},
		{
			name: "Invalid JSON",
			mockConfig: func() []byte {
				return []byte(`{invalid-json`)
			},
			expectedStatus: http.StatusInternalServerError,
			checkError:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &Handler{
				logger:         logger,
				configProvider: tt.mockConfig,
			}

			req := httptest.NewRequest(http.MethodGet, "/sports/config", nil)
			w := httptest.NewRecorder()

			h.HandleConfig(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.expectedStatus)
			}

			if tt.checkError {
				var errResp apierrors.ErrorResponse
				if err := json.Unmarshal(w.Body.Bytes(), &errResp); err != nil {
					t.Fatalf("failed to unmarshal error response: %v", err)
				}
				if errResp.Error == "" {
					t.Error("expected error message in response")
				}
			} else {
				if w.Body.String() != tt.expectedBody {
					t.Errorf("body = %q, want %q", w.Body.String(), tt.expectedBody)
				}
			}
		})
	}
}
