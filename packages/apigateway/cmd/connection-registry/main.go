// connection-registry is an explicit-target operator tool. Inventory is read-only;
// mutations require project confirmation and an independently reviewed manifest.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/connectionbootstrap"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
)

const (
	modeInventory = "inventory"
	modeFreeze    = "freeze"
	modeApply     = "apply"
	modeVerify    = "verify"
	modeRollback  = "rollback"
	modeSeal      = "seal"
)

type options struct{ mode, project, database, manifest, confirm string }

// operationReceipt is credential-free progress, retained even on partial failure.
type operationReceipt struct {
	Mode         string `json:"mode"`
	Project      string `json:"project"`
	Database     string `json:"database"`
	OperationID  string `json:"operation_id"`
	UID          string `json:"uid,omitempty"`
	Outcome      string `json:"outcome,omitempty"`
	Warning      string `json:"warning,omitempty"`
	ResumeSignIn string `json:"resume_sign_in,omitempty"`
}

func commandError(operation string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("registry command %s: %w", operation, err)
}

func parseOptions(args []string) (options, error) {
	var result options
	flags := flag.NewFlagSet("connection-registry", flag.ContinueOnError)
	flags.StringVar(&result.mode, "mode", modeInventory, "inventory, freeze, apply, verify, rollback, or seal")
	flags.StringVar(&result.project, "project", "", "explicit Firebase/GCP project")
	flags.StringVar(&result.database, "database", "", "explicit Firestore database")
	flags.StringVar(&result.manifest, "manifest", "", "reviewed JSON manifest (apply/verify/rollback)")
	flags.StringVar(&result.confirm, "confirm-project", "", "required for mutations; must match --project")
	if parseErr := flags.Parse(args); parseErr != nil {
		return result, commandError("flags", parseErr)
	}
	if flags.NArg() != 0 || result.project == "" || result.database == "" {
		return result, errors.New("explicit --project and --database required; positional arguments are not accepted")
	}
	switch result.mode {
	case modeInventory, modeFreeze, modeApply, modeVerify, modeRollback, modeSeal:
	default:
		return result, errors.New("unknown registry mode")
	}
	if result.mode != modeInventory && result.mode != modeVerify && result.confirm != result.project {
		return result, errors.New("mutation requires --confirm-project matching --project")
	}
	return result, nil
}

func readManifest(config *options) (connectionbootstrap.Manifest, error) {
	var manifest connectionbootstrap.Manifest
	if config.mode != modeApply && config.mode != modeVerify && config.mode != modeRollback {
		return manifest, nil
	}
	file, openErr := os.Open(config.manifest) //nolint:gosec // Operator-selected local path, not an HTTP/client input.
	if openErr != nil {
		return manifest, commandError("open manifest", openErr)
	}
	defer func() { warnClose("manifest", file.Close()) }()
	data, readErr := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if readErr != nil {
		return manifest, commandError("read manifest", readErr)
	}
	if len(data) > 1<<20 {
		return manifest, errors.New("manifest exceeds one MiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decodeErr := decoder.Decode(&manifest); decodeErr != nil {
		return manifest, commandError("decode manifest", decodeErr)
	}
	var extra any
	if decodeErr := decoder.Decode(&extra); !errors.Is(decodeErr, io.EOF) {
		return manifest, errors.New("manifest must contain one JSON object")
	}
	return manifest, commandError("validate manifest", manifest.Validate(config.project, config.database))
}

func run(ctx context.Context, args []string, out io.Writer) error {
	config, parseErr := parseOptions(args)
	if parseErr != nil {
		return parseErr
	}
	manifest, manifestErr := readManifest(&config)
	if manifestErr != nil {
		return manifestErr
	}
	db, clientErr := firestore.NewClientWithDatabase(ctx, config.project, config.database)
	if clientErr != nil {
		return commandError("Firestore client", clientErr)
	}
	defer func() { warnClose("Firestore", db.Close()) }()
	store := activityconnection.Store{Client: db}
	switch config.mode {
	case modeFreeze:
		return commandError("freeze admissions", store.Freeze(ctx))
	case modeSeal:
		return commandError("seal bootstrap", store.Seal(ctx))
	case modeRollback:
		return rollback(ctx, store, &manifest, out)
	default:
		return inventoryOperation(ctx, &config, db, store, &manifest, out)
	}
}

func rollback(ctx context.Context, store activityconnection.Store, manifest *connectionbootstrap.Manifest, out io.Writer) error {
	// Emit the sign-in consequence before any mutation, including partial failures.
	if encodeErr := json.NewEncoder(out).Encode(operationReceipt{Mode: modeRollback, Project: manifest.Project, Database: manifest.Database, OperationID: manifest.OperationID, Warning: "rollback keeps admissions frozen; rolled-back users cannot start a new sign-in", ResumeSignIn: "re-apply a reviewed manifest and verify"}); encodeErr != nil {
		return commandError("encode rollback notice", encodeErr)
	}
	removed, retained := 0, 0
	for _, uid := range manifest.UIDs {
		expected := connectionbootstrap.Record(uid, manifest.OperationID)
		outcome, rollbackErr := store.Rollback(ctx, &expected)
		if rollbackErr != nil {
			return commandError("rollback UID "+uid, rollbackErr)
		}
		switch outcome {
		case activityconnection.RollbackRemoved:
			removed++
		case activityconnection.RollbackOtherOperation:
			retained++
		case activityconnection.RollbackAbsent:
			// Successful retry; nothing left to remove.
		}
		if receiptErr := writeOwnerReceipt(out, modeRollback, manifest, uid, string(outcome)); receiptErr != nil {
			return receiptErr
		}
	}
	if removed == 0 && retained > 0 {
		return errors.New("rollback matched no records for this operation; check operation_id in the manifest")
	}
	return nil
}

func writeOwnerReceipt(out io.Writer, mode string, manifest *connectionbootstrap.Manifest, uid, outcome string) error {
	return commandError("encode receipt UID "+uid, json.NewEncoder(out).Encode(operationReceipt{Mode: mode, Project: manifest.Project, Database: manifest.Database, OperationID: manifest.OperationID, UID: uid, Outcome: outcome}))
}

func inventoryOperation(ctx context.Context, config *options, db *firestore.Client, store activityconnection.Store, manifest *connectionbootstrap.Manifest, out io.Writer) error {
	postgresURL := os.Getenv("POSTGRES_CONNECTION_STRING")
	if postgresURL == "" {
		return errors.New("POSTGRES_CONNECTION_STRING required for read-only owner inventory")
	}
	app, appErr := firebase.NewApp(ctx, &firebase.Config{ProjectID: config.project})
	if appErr != nil {
		return commandError("Firebase app", appErr)
	}
	auth, authErr := app.Auth(ctx)
	if authErr != nil {
		return commandError("Auth client", authErr)
	}
	inventory, scanErr := connectionbootstrap.Scan(ctx, auth, db, postgresURL, config.project, config.database)
	if scanErr != nil {
		return commandError(modeInventory, scanErr)
	}
	if config.mode == modeInventory {
		return commandError("encode inventory", json.NewEncoder(out).Encode(inventory))
	}
	if reviewErr := connectionbootstrap.Review(&inventory, manifest); reviewErr != nil {
		return commandError("review", reviewErr)
	}
	if operationErr := applyOrVerify(ctx, config.mode, auth, store, manifest, out); operationErr != nil {
		return operationErr
	}
	return commandError("encode verification", json.NewEncoder(out).Encode(map[string]any{"mode": config.mode, "project": config.project, "database": config.database, "verified_owners": len(manifest.UIDs), "postgres_target": inventory.PostgresTarget, "operation_id": manifest.OperationID, "verified_at": time.Now().UTC().Format(time.RFC3339)}))
}

func applyOrVerify(ctx context.Context, mode string, auth *firebaseauth.Client, store activityconnection.Store, manifest *connectionbootstrap.Manifest, out io.Writer) error {
	for _, uid := range manifest.UIDs {
		if mode == modeApply {
			// External Auth metadata is rechecked OUTSIDE retryable Firestore closures.
			user, userErr := auth.GetUser(ctx, uid)
			if userErr != nil {
				return commandError("recheck Auth UID "+uid, userErr)
			}
			if user.Disabled || len(user.ProviderUserInfo) != 0 {
				return fmt.Errorf("legacy Auth provenance changed for %s", uid)
			}
			expected := connectionbootstrap.Record(uid, manifest.OperationID)
			created, claimErr := store.Claim(ctx, &expected)
			if claimErr != nil {
				return commandError("claim UID "+uid, claimErr)
			}
			outcome := "existing"
			if created {
				outcome = "created"
			}
			if receiptErr := writeOwnerReceipt(out, mode, manifest, uid, outcome); receiptErr != nil {
				return receiptErr
			}
		}
		record, resolveErr := store.Resolve(ctx, uid)
		if resolveErr != nil {
			return commandError("resolve owner UID "+uid, resolveErr)
		}
		if record.UID != uid || record.Subject != uid || record.Provenance != activityconnection.LegacyUID {
			return commandError("verify UID "+uid, activityconnection.ErrConflict)
		}
		if mode == modeVerify {
			if receiptErr := writeOwnerReceipt(out, mode, manifest, uid, "verified"); receiptErr != nil {
				return receiptErr
			}
		}
	}
	return nil
}

func mainCode() int {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if runErr := run(ctx, os.Args[1:], os.Stdout); runErr != nil {
		fmt.Fprintln(os.Stderr, runErr)
		return 1
	}

	return 0
}

func main() { os.Exit(mainCode()) }

func warnClose(resource string, err error) {
	if err != nil {
		slog.Warn("close registry resource", "resource", resource, "error", err)
	}
}
