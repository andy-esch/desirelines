package activityconnection

import (
	"context"
	"errors"
	"fmt"
	"reflect"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Store uses only Firestore transactions. External OAuth/Auth calls belong outside retries.
type Store struct{ Client *firestore.Client }

// Migration controls legacy admissions and the irreversible resolver-rollout boundary.
type Migration struct {
	Frozen          bool `firestore:"frozen" json:"frozen"`
	RollbackAllowed bool `firestore:"rollback_allowed" json:"rollback_allowed"`
}

func registryError(operation string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("connection registry %s: %w", operation, err)
}

func (s Store) transact(ctx context.Context, f func(context.Context, *firestore.Transaction) error) error {
	return registryError("transaction", s.Client.RunTransaction(ctx, f))
}

func (s Store) refs(uid, subject string) (*firestore.DocumentRef, *firestore.DocumentRef) {
	return s.Client.Collection(LookupsCollection).Doc(Provider + ":" + subject), s.Client.Collection(stravatoken.UsersCollection).Doc(uid).Collection(ConnectionsCollection).Doc(Provider)
}

func readRecord(tx *firestore.Transaction, ref *firestore.DocumentRef) (*Record, error) {
	snap, getErr := tx.Get(ref)
	if status.Code(getErr) == codes.NotFound {
		return nil, nil
	}
	if getErr != nil {
		return nil, registryError("read", getErr)
	}
	data := snap.Data()
	typ := reflect.TypeOf(Record{})
	if len(data) != typ.NumField() {
		return nil, ErrConflict
	}
	for i := range typ.NumField() {
		value, present := data[typ.Field(i).Tag.Get("firestore")]
		if !present {
			return nil, ErrConflict
		}
		if typ.Field(i).Type.Kind() == reflect.String {
			if _, isString := value.(string); !isString {
				return nil, ErrConflict
			}
		}
	}
	if _, isInteger := data["schema_version"].(int64); !isInteger {
		return nil, ErrConflict
	}
	var record Record
	if decodeErr := snap.DataTo(&record); decodeErr != nil {
		return nil, registryError("decode", decodeErr)
	}
	// DataTo leaves an explicit empty array as a nil slice; null remains invalid.
	if scopes, ok := data["scopes"].([]any); ok && len(scopes) == 0 {
		record.Scopes = []string{}
	}
	if validationErr := record.Validate(); validationErr != nil {
		return nil, fmt.Errorf("%w at %s: %w", ErrConflict, ref.Path, validationErr)
	}
	return &record, nil
}

func (s Store) migration(tx *firestore.Transaction) (Migration, error) {
	snap, getErr := tx.Get(s.Client.Collection(MigrationCollection).Doc(MigrationDocument))
	if status.Code(getErr) == codes.NotFound {
		return Migration{}, nil
	}
	if getErr != nil {
		return Migration{}, registryError("read migration", getErr)
	}
	frozen, validFreeze := snap.Data()["frozen"].(bool)
	rollback, validRollback := snap.Data()["rollback_allowed"].(bool)
	if !validFreeze || !validRollback {
		return Migration{}, errors.New("invalid legacy admission control")
	}
	return Migration{Frozen: frozen, RollbackAllowed: rollback}, nil
}

// CheckLegacyAdmission runs in the credential-write transaction. A freeze permits
// only an already mapped, still-admitted legacy UID; no new user or reactivation.
func (s Store) CheckLegacyAdmission(tx *firestore.Transaction, subject string) error {
	if _, keyErr := LookupKey(subject); keyErr != nil {
		return keyErr
	}
	if _, getErr := tx.Get(s.Client.Collection(stravatoken.AllowlistCollection).Doc(subject)); getErr != nil {
		if status.Code(getErr) == codes.NotFound {
			return ErrAdmissionDenied
		}
		return registryError("read admission", getErr)
	}
	migration, migrationErr := s.migration(tx)
	if migrationErr != nil || !migration.Frozen {
		return migrationErr
	}
	lookup, connection := s.refs(subject, subject)
	a, lookupErr := readRecord(tx, lookup)
	if lookupErr != nil {
		return lookupErr
	}
	b, connectionErr := readRecord(tx, connection)
	if connectionErr != nil {
		return connectionErr
	}
	if !samePair(a, b) || a.UID != subject || a.Subject != subject || a.Status != Active {
		return ErrAdmissionDenied
	}
	return nil
}

func (s Store) checkBootstrap(tx *firestore.Transaction, record *Record) error {
	if record.Provenance != LegacyUID {
		return nil
	}
	migration, migrationErr := s.migration(tx)
	if migrationErr != nil {
		return migrationErr
	}
	if !migration.Frozen || !migration.RollbackAllowed {
		return errors.New("legacy bootstrap requires frozen admissions and unsealed rollback")
	}
	// Deletion removes this admission in the same commit as the registry pair.
	_, getErr := tx.Get(s.Client.Collection(stravatoken.AllowlistCollection).Doc(record.UID))
	return registryError("legacy eligibility", getErr)
}

// Claim atomically enforces both ownership directions. Repeated claims preserve
// an existing operation's provenance and never overwrite credentials or metadata.
func (s Store) Claim(ctx context.Context, record *Record) (bool, error) {
	if record == nil {
		return false, ErrConflict
	}
	if validationErr := record.Validate(); validationErr != nil {
		return false, validationErr
	}
	if record.Status != Active {
		return false, ErrNotFound
	}
	created := false
	transactionErr := s.transact(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		created = false
		if bootstrapErr := s.checkBootstrap(tx, record); bootstrapErr != nil {
			return bootstrapErr
		}
		lookup, connection := s.refs(record.UID, record.Subject)
		a, lookupErr := readRecord(tx, lookup)
		if lookupErr != nil {
			return lookupErr
		}
		b, connectionErr := readRecord(tx, connection)
		if connectionErr != nil {
			return connectionErr
		}
		if a != nil || b != nil {
			if !sameOwner(a, b, record) {
				return ErrConflict
			}
			return nil
		}
		if writeErr := tx.Create(lookup, record); writeErr != nil {
			return registryError("claim lookup", writeErr)
		}
		if writeErr := tx.Create(connection, record); writeErr != nil {
			return registryError("claim connection", writeErr)
		}
		created = true
		return nil
	})
	return created && transactionErr == nil, transactionErr
}

// Resolve returns ownership only when both active records agree.
func (s Store) Resolve(ctx context.Context, subject string) (Record, error) {
	if _, keyErr := LookupKey(subject); keyErr != nil {
		return Record{}, keyErr
	}
	var result Record
	transactionErr := s.transact(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		var resolveErr error
		result, resolveErr = s.ResolveInTransaction(tx, subject)
		return resolveErr
	})
	if transactionErr != nil {
		return Record{}, transactionErr
	}
	return result, nil
}

// ResolveInTransaction reads the active pair in the caller's snapshot. Credential
// callers can read ownership and tokens in one transaction; finish all reads
// before scheduling writes. External OAuth/Auth calls stay outside retries.
func (s Store) ResolveInTransaction(tx *firestore.Transaction, subject string) (Record, error) {
	key, keyErr := LookupKey(subject)
	if keyErr != nil {
		return Record{}, keyErr
	}
	a, lookupErr := readRecord(tx, s.Client.Collection(LookupsCollection).Doc(key))
	if lookupErr != nil {
		return Record{}, lookupErr
	}
	if a == nil || a.Status != Active {
		return Record{}, ErrNotFound
	}
	_, connection := s.refs(a.UID, subject)
	b, connectionErr := readRecord(tx, connection)
	if connectionErr != nil {
		return Record{}, connectionErr
	}
	if !samePair(a, b) || a.Subject != subject {
		return Record{}, ErrConflict
	}
	return *a, nil
}

// RollbackOutcome reports the committed disposition of one operation's pair.
type RollbackOutcome string

// Rollback outcomes distinguish retries from records belonging to another run.
const (
	RollbackRemoved        RollbackOutcome = "removed"
	RollbackAbsent         RollbackOutcome = "already_absent"
	RollbackOtherOperation RollbackOutcome = "retained_other_operation"
)

// Rollback removes only the unchanged pair belonging to this exact operation.
// Admissions stay frozen: re-apply and verify before users can sign in again.
// Seal must be called before deployed resolvers begin depending on the records.
func (s Store) Rollback(ctx context.Context, record *Record) (RollbackOutcome, error) {
	if record == nil {
		return "", ErrConflict
	}
	if validationErr := record.Validate(); validationErr != nil {
		return "", validationErr
	}
	if record.Provenance != LegacyUID {
		return "", ErrConflict
	}
	var outcome RollbackOutcome
	transactionErr := s.transact(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		outcome = ""
		migration, migrationErr := s.migration(tx)
		if migrationErr != nil {
			return migrationErr
		}
		if !migration.Frozen || !migration.RollbackAllowed {
			return errors.New("bootstrap rollback is not enabled")
		}
		lookup, connection := s.refs(record.UID, record.Subject)
		a, lookupErr := readRecord(tx, lookup)
		if lookupErr != nil {
			return lookupErr
		}
		b, connectionErr := readRecord(tx, connection)
		if connectionErr != nil {
			return connectionErr
		}
		outcome, connectionErr = rollbackDisposition(a, b, record)
		if connectionErr != nil || outcome != RollbackRemoved {
			return connectionErr
		}
		if deleteErr := tx.Delete(lookup); deleteErr != nil {
			return registryError("rollback lookup", deleteErr)
		}
		if deleteErr := tx.Delete(connection); deleteErr != nil {
			return registryError("rollback connection", deleteErr)
		}
		outcome = RollbackRemoved
		return nil
	})
	if transactionErr != nil {
		return "", transactionErr
	}
	return outcome, nil
}

func rollbackDisposition(a, b, expected *Record) (RollbackOutcome, error) {
	if a == nil && b == nil {
		return RollbackAbsent, nil
	}
	if !sameOwner(a, b, expected) {
		return "", ErrConflict
	}
	if a.BootstrapID != expected.BootstrapID {
		return RollbackOtherOperation, nil
	}
	if !reflect.DeepEqual(a, expected) {
		return "", ErrConflict
	}
	return RollbackRemoved, nil
}

// Freeze creates the control once; it cannot reopen a sealed bootstrap.
func (s Store) Freeze(ctx context.Context) error {
	return s.transact(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		ref := s.Client.Collection(MigrationCollection).Doc(MigrationDocument)
		_, getErr := tx.Get(ref)
		if status.Code(getErr) == codes.NotFound {
			return registryError("freeze", tx.Create(ref, Migration{Frozen: true, RollbackAllowed: true}))
		}
		if getErr != nil {
			return registryError("read freeze", getErr)
		}
		migration, migrationErr := s.migration(tx)
		if migrationErr != nil {
			return migrationErr
		}
		if !migration.Frozen || !migration.RollbackAllowed {
			return errors.New("migration control already advanced; cannot reopen bootstrap")
		}
		return nil
	})
}

// Seal disables bootstrap writes and rollback before ownership resolver rollout.
func (s Store) Seal(ctx context.Context) error {
	return s.transact(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		migration, migrationErr := s.migration(tx)
		if migrationErr != nil {
			return migrationErr
		}
		if !migration.Frozen {
			return errors.New("admissions are not frozen")
		}
		return registryError("seal", tx.Update(s.Client.Collection(MigrationCollection).Doc(MigrationDocument), []firestore.Update{{Path: "rollback_allowed", Value: false}}))
	})
}

func samePair(a, b *Record) bool {
	return a != nil && b != nil && reflect.DeepEqual(a, b)
}

func sameOwner(a, b, expected *Record) bool {
	return samePair(a, b) && a.UID == expected.UID && a.Subject == expected.Subject && a.Status == Active
}
