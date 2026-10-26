package connectionbootstrap

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"

	"cloud.google.com/go/firestore"
	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/jackc/pgx/v5"
	"google.golang.org/api/iterator"
)

func inventoryError(operation string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("identity inventory %s: %w", operation, err)
}
func (i *Inventory) issue(uid, reason string, blocking bool) {
	i.Issues = append(i.Issues, Issue{UID: uid, Reason: reason, Blocking: blocking})
}

// Scan reads server-managed identities/admissions, document paths and persisted
// ownership. Token payloads are never read. Profiles can report a mismatch only.
func Scan(ctx context.Context, auth *firebaseauth.Client, db *firestore.Client, postgresURL, project, database string) (Inventory, error) {
	out := Inventory{Project: project, Database: database, Candidates: []string{}, Issues: []Issue{}}
	config, configErr := pgx.ParseConfig(postgresURL)
	if configErr != nil {
		return out, inventoryError("parse Postgres target", configErr)
	}
	out.PostgresTarget = fmt.Sprintf("%s:%d/%s", config.Host, config.Port, config.Database)
	users, userErr := readUsers(ctx, auth)
	if userErr != nil {
		return out, userErr
	}
	allowed, admissionErr := readAdmissions(ctx, db)
	if admissionErr != nil {
		return out, admissionErr
	}
	out.checkAuth(users, allowed)
	if documentErr := out.checkUserDocuments(ctx, db, users, allowed); documentErr != nil {
		return out, documentErr
	}
	if persistedErr := out.checkPersistedOwners(ctx, postgresURL, users, allowed); persistedErr != nil {
		return out, persistedErr
	}
	if registryErr := out.checkRegistry(ctx, db, users, allowed); registryErr != nil {
		return out, registryErr
	}
	slices.Sort(out.Candidates)
	slices.SortFunc(out.Issues, func(a, b Issue) int { return cmp.Or(cmp.Compare(a.UID, b.UID), cmp.Compare(a.Reason, b.Reason)) })
	return out, nil
}

func readUsers(ctx context.Context, auth *firebaseauth.Client) (map[string]*firebaseauth.ExportedUserRecord, error) {
	users := map[string]*firebaseauth.ExportedUserRecord{}
	iter := auth.Users(ctx, "")
	for {
		user, nextErr := iter.Next()
		if errors.Is(nextErr, iterator.Done) {
			return users, nil
		}
		if nextErr != nil {
			return nil, inventoryError("list Auth users", nextErr)
		}
		users[user.UID] = user
	}
}
func readAdmissions(ctx context.Context, db *firestore.Client) (map[string]bool, error) {
	allowed := map[string]bool{}
	refs := db.Collection("allowlist").DocumentRefs(ctx)
	for {
		ref, nextErr := refs.Next()
		if errors.Is(nextErr, iterator.Done) {
			return allowed, nil
		}
		if nextErr != nil {
			return nil, inventoryError("list admissions", nextErr)
		}
		if _, getErr := ref.Get(ctx); getErr != nil {
			return nil, inventoryError("read admission", getErr)
		}
		allowed[ref.ID] = true
	}
}
func (i *Inventory) checkAuth(users map[string]*firebaseauth.ExportedUserRecord, allowed map[string]bool) {
	for uid, user := range users {
		_, keyErr := activityconnection.LookupKey(uid)
		if keyErr != nil || !allowed[uid] || user.Disabled || len(user.ProviderUserInfo) != 0 || user.UserMetadata == nil || user.UserMetadata.LastLogInTimestamp == 0 {
			i.issue(uid, "not an active legacy-custom-auth UID with matching admission; review provenance", allowed[uid])
			continue
		}
		i.Candidates = append(i.Candidates, uid)
	}
	for uid := range allowed {
		if users[uid] == nil {
			i.issue(uid, "allowlist-only entry has no existing Firebase user", false)
		}
	}
}
func (i *Inventory) checkUserDocuments(ctx context.Context, db *firestore.Client, users map[string]*firebaseauth.ExportedUserRecord, allowed map[string]bool) error {
	// DocumentRefs includes missing parents whose subcollections contain user data.
	refs := db.Collection("users").DocumentRefs(ctx)
	seen := map[string]bool{}
	for {
		ref, nextErr := refs.Next()
		if errors.Is(nextErr, iterator.Done) {
			for _, uid := range i.Candidates {
				if !seen[uid] {
					i.issue(uid, "missing legacy Firestore user documents", true)
				}
			}
			return nil
		}
		if nextErr != nil {
			return inventoryError("list user paths", nextErr)
		}
		if users[ref.ID] == nil || !allowed[ref.ID] {
			i.issue(ref.ID, "orphan Firestore user paths", true)
		}
		seen[ref.ID] = true
		if profileErr := i.checkLegacyDocuments(ctx, ref, slices.Contains(i.Candidates, ref.ID)); profileErr != nil {
			return profileErr
		}
	}
}
func (i *Inventory) checkLegacyDocuments(ctx context.Context, user *firestore.DocumentRef, eligible bool) error {
	// An empty projection returns names only; never fetch credential payloads.
	docs, listErr := user.Collection("private").Select().Documents(ctx).GetAll()
	if listErr != nil {
		return inventoryError("list legacy private paths", listErr)
	}
	present := map[string]bool{}
	for _, doc := range docs {
		present[doc.Ref.ID] = true
	}
	if eligible && (!present["profile"] || !present["strava_tokens"]) {
		i.issue(user.ID, "missing legacy credential/profile documents", true)
	}
	if !present["profile"] {
		return nil
	}
	profile, getErr := user.Collection("private").Doc("profile").Get(ctx)
	if getErr != nil {
		return inventoryError("read profile metadata", getErr)
	}
	value, isInteger := profile.Data()["strava_athlete_id"].(int64)
	if !isInteger || strconv.FormatInt(value, 10) != user.ID {
		i.issue(user.ID, "untrusted profile subject mismatch; not ownership evidence", true)
	}
	return nil
}
func (i *Inventory) checkPersistedOwners(ctx context.Context, postgresURL string, users map[string]*firebaseauth.ExportedUserRecord, allowed map[string]bool) error {
	conn, connectErr := pgx.Connect(ctx, postgresURL)
	if connectErr != nil {
		return inventoryError("open Postgres", connectErr)
	}
	defer func() {
		if closeErr := conn.Close(ctx); closeErr != nil {
			slog.Warn("close inventory database", "error", closeErr)
		}
	}()
	tx, beginErr := conn.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if beginErr != nil {
		return inventoryError("read-only transaction", beginErr)
	}
	defer func() {
		if rollbackErr := tx.Rollback(ctx); rollbackErr != nil && !errors.Is(rollbackErr, pgx.ErrTxClosed) {
			slog.Warn("close read-only inventory", "error", rollbackErr)
		}
	}()
	if visibilityErr := checkOwnerVisibility(ctx, tx); visibilityErr != nil {
		return visibilityErr
	}
	rows, queryErr := tx.Query(ctx, `SELECT DISTINCT a.user_id, COALESCE(e.source,''), COALESCE(e.external_owner_id,'') FROM desirelines.activities a LEFT JOIN desirelines.activity_external_ids e ON e.activity_id=a.id`)
	if queryErr != nil {
		return inventoryError("read persisted owners", queryErr)
	}
	defer rows.Close()
	for rows.Next() {
		var uid, source, owner string
		if scanErr := rows.Scan(&uid, &source, &owner); scanErr != nil {
			return inventoryError("decode persisted owner", scanErr)
		}
		if !allowed[uid] || users[uid] == nil || source != "strava" || owner != uid {
			i.issue(uid, "persisted owner/source conflicts with legacy UID/admission", true)
		}
	}
	return inventoryError("iterate persisted owners", rows.Err())
}
func checkOwnerVisibility(ctx context.Context, tx pgx.Tx) error {
	var visible bool
	queryErr := tx.QueryRow(ctx, `SELECT NOT c.relrowsecurity OR r.rolsuper OR r.rolbypassrls OR (NOT c.relforcerowsecurity AND pg_has_role(c.relowner, 'USAGE')) FROM pg_class c CROSS JOIN pg_roles r WHERE c.oid='desirelines.activities'::regclass AND r.rolname=current_user`).Scan(&visible)
	if queryErr != nil {
		return inventoryError("check ownership visibility", queryErr)
	}
	if !visible {
		return errors.New("ownership inventory needs an operator role that sees all activity owners; RLS-filtered snapshots are unsafe")
	}
	return nil
}
func (i *Inventory) checkRegistry(ctx context.Context, db *firestore.Client, users map[string]*firebaseauth.ExportedUserRecord, allowed map[string]bool) error {
	iter := db.Collection(activityconnection.LookupsCollection).Documents(ctx)
	defer iter.Stop()
	for {
		doc, nextErr := iter.Next()
		if errors.Is(nextErr, iterator.Done) {
			return nil
		}
		if nextErr != nil {
			return inventoryError("list registry", nextErr)
		}
		var record activityconnection.Record
		if decodeErr := doc.DataTo(&record); decodeErr != nil {
			return inventoryError("decode lookup", decodeErr)
		}
		key, keyErr := activityconnection.LookupKey(record.Subject)
		resolved, resolveErr := (activityconnection.Store{Client: db}).Resolve(ctx, record.Subject)
		if resolveErr != nil || keyErr != nil || key != doc.Ref.ID || resolved.UID != record.Subject || !allowed[resolved.UID] || users[resolved.UID] == nil {
			i.issue(doc.Ref.ID, "orphan/conflicting registry lookup", true)
		}
	}
}
