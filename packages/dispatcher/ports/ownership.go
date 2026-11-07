package ports

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
)

// CredentialOwner pins a grant to its app UID and Strava subject across retries.
// UID is the credential/admission key; Subject remains the external athlete ID.
type CredentialOwner struct {
	UID     string
	Subject int64
}

// Validate rejects unsafe document keys and invalid Strava subjects.
func (o CredentialOwner) Validate() error {
	if err := activityconnection.ValidateUID(o.UID); err != nil {
		return fmt.Errorf("%w: invalid credential UID", activityconnection.ErrConflict)
	}
	if o.Subject <= 0 {
		return fmt.Errorf("%w: invalid Strava subject", activityconnection.ErrConflict)
	}
	return nil
}

// ConnectionResolver reads the authoritative active ownership pair; never cache it.
type ConnectionResolver interface {
	Resolve(context.Context, string) (activityconnection.Record, error)
}

// ResolveOwner refuses missing, inactive or inconsistent registry records.
func ResolveOwner(ctx context.Context, resolver ConnectionResolver, subject int64) (CredentialOwner, error) {
	if resolver == nil {
		return CredentialOwner{}, errors.New("activity connection resolver is required")
	}
	subjectKey := strconv.FormatInt(subject, 10)
	record, err := resolver.Resolve(ctx, subjectKey)
	if err != nil {
		return CredentialOwner{}, fmt.Errorf("resolve activity owner: %w", err)
	}
	if record.Validate() != nil || record.Subject != subjectKey || record.Status != activityconnection.Active {
		return CredentialOwner{}, activityconnection.ErrConflict
	}
	return CredentialOwner{UID: record.UID, Subject: subject}, nil
}
