package pubsub_test

import (
	"strings"
	"testing"

	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/pubsub"
)

func TestValidateProjectID(t *testing.T) {
	tests := []struct {
		name      string
		projectID string
		wantErr   bool
		errMsg    string
	}{
		// Valid
		{name: "typical project", projectID: "my-gcp-project", wantErr: false},
		{name: "minimum length (6)", projectID: "abcdef", wantErr: false},
		{name: "maximum length (30)", projectID: "a" + strings.Repeat("b", 28) + "c", wantErr: false},
		{name: "digits in middle", projectID: "project-123-abc", wantErr: false},
		{name: "ends with digit", projectID: "my-project-1", wantErr: false},

		// Invalid
		{name: "empty", projectID: "", wantErr: true, errMsg: "required"},
		{name: "too short (5)", projectID: "abcde", wantErr: true, errMsg: "invalid"},
		{name: "too long (31)", projectID: "a" + strings.Repeat("b", 29) + "c", wantErr: true, errMsg: "invalid"},
		{name: "starts with digit", projectID: "1project", wantErr: true, errMsg: "invalid"},
		{name: "starts with hyphen", projectID: "-project", wantErr: true, errMsg: "invalid"},
		{name: "ends with hyphen", projectID: "project-", wantErr: true, errMsg: "invalid"},
		{name: "uppercase letters", projectID: "My-Project", wantErr: true, errMsg: "invalid"},
		{name: "underscores", projectID: "my_project_id", wantErr: true, errMsg: "invalid"},
		{name: "spaces", projectID: "my project", wantErr: true, errMsg: "invalid"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := pubsub.ValidateProjectID(tt.projectID)
			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error for %q, got nil", tt.projectID)
				} else if tt.errMsg != "" && !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("expected error containing %q, got %q", tt.errMsg, err.Error())
				}
			} else if err != nil {
				t.Errorf("unexpected error for %q: %v", tt.projectID, err)
			}
		})
	}
}

func TestValidateTopicID(t *testing.T) {
	tests := []struct {
		name    string
		topicID string
		wantErr bool
		errMsg  string
	}{
		// Valid
		{name: "typical topic", topicID: "webhook-events", wantErr: false},
		{name: "minimum length (3)", topicID: "abc", wantErr: false},
		{name: "with underscores", topicID: "webhook_events_v2", wantErr: false},
		{name: "with periods", topicID: "events.v2.prod", wantErr: false},
		{name: "with tilde", topicID: "events~test", wantErr: false},
		{name: "uppercase", topicID: "WebhookEvents", wantErr: false},
		{name: "mixed chars", topicID: "events-v2_prod.test", wantErr: false},

		// Invalid
		{name: "empty", topicID: "", wantErr: true, errMsg: "required"},
		{name: "too short (2)", topicID: "ab", wantErr: true, errMsg: "invalid"},
		{name: "starts with digit", topicID: "1events", wantErr: true, errMsg: "invalid"},
		{name: "starts with hyphen", topicID: "-events", wantErr: true, errMsg: "invalid"},
		{name: "starts with underscore", topicID: "_events", wantErr: true, errMsg: "invalid"},
		{name: "contains spaces", topicID: "my events", wantErr: true, errMsg: "invalid"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := pubsub.ValidateTopicID(tt.topicID)
			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error for %q, got nil", tt.topicID)
				} else if tt.errMsg != "" && !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("expected error containing %q, got %q", tt.errMsg, err.Error())
				}
			} else if err != nil {
				t.Errorf("unexpected error for %q: %v", tt.topicID, err)
			}
		})
	}
}
