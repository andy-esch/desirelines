//go:build integration

package postgres_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andy-esch/desirelines/packages/apigateway/adapters/postgres"
)

// withTestTx runs fn inside a database transaction that is rolled back after fn returns.
// This gives each test a clean, isolated view of the database without manual cleanup.
func withTestTx(t *testing.T, pool *pgxpool.Pool, fn func(repo *postgres.ActivityRepository)) {
	t.Helper()
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after test is best-effort

	seedTestData(t, tx)
	fn(postgres.NewTestActivityRepository(tx))
}

// withTestTxMultiUser is like withTestTx but seeds data for two users to test query isolation.
func withTestTxMultiUser(t *testing.T, pool *pgxpool.Pool, fn func(repo *postgres.ActivityRepository)) {
	t.Helper()
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after test is best-effort

	seedTestData(t, tx)
	seedOtherUserData(t, tx)
	fn(postgres.NewTestActivityRepository(tx))
}

// seedOtherUserData inserts a single activity for "other-user" to test isolation.
//
// Test data:
//   - ID 2001: Run, Jan 15 09:00, 3km, user_id="other-user"
func seedOtherUserData(t *testing.T, tx pgx.Tx) {
	t.Helper()
	ctx := context.Background()

	_, err := tx.Exec(ctx, `
		INSERT INTO desirelines.activities (
			id, user_id, name, type, sport, start_date_local, year,
			distance, moving_time, elapsed_time, total_elevation_gain
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`,
		int64(2001), "other-user", "Evening Run", "Run", "Run",
		time.Date(2024, 1, 15, 9, 0, 0, 0, time.UTC), 2024,
		float64(3000), int32(900), int32(1000), float64(20),
	)
	if err != nil {
		t.Fatalf("failed to insert other-user test activity: %v", err)
	}
}

// seedTestData inserts the standard set of 4 test activities into the transaction.
//
// Test data:
//   - ID 1001: Ride, Jan 15 08:00, 10km
//   - ID 1002: Ride, Jan 16 14:00, 15km
//   - ID 1003: Run,  Jan 15 07:00, 5km
//   - ID 1004: Yoga (type=Workout), Jan 15 06:00, 0km
func seedTestData(t *testing.T, tx pgx.Tx) {
	t.Helper()
	ctx := context.Background()

	testActivities := []struct {
		id             int64
		userID         string
		name           string
		activityType   string
		sport          string
		startDateLocal time.Time
		year           int
		distance       float64
		movingTime     int32
		elapsedTime    int32
		elevationGain  float64
	}{
		{
			id:             1001,
			userID:         "test-user",
			name:           "Morning Ride",
			activityType:   "Ride",
			sport:          "Ride",
			startDateLocal: time.Date(2024, 1, 15, 8, 0, 0, 0, time.UTC),
			year:           2024,
			distance:       10000,
			movingTime:     1800,
			elapsedTime:    2000,
			elevationGain:  100,
		},
		{
			id:             1002,
			userID:         "test-user",
			name:           "Afternoon Ride",
			activityType:   "Ride",
			sport:          "Ride",
			startDateLocal: time.Date(2024, 1, 16, 14, 0, 0, 0, time.UTC),
			year:           2024,
			distance:       15000,
			movingTime:     2700,
			elapsedTime:    3000,
			elevationGain:  200,
		},
		{
			id:             1003,
			userID:         "test-user",
			name:           "Morning Run",
			activityType:   "Run",
			sport:          "Run",
			startDateLocal: time.Date(2024, 1, 15, 7, 0, 0, 0, time.UTC),
			year:           2024,
			distance:       5000,
			movingTime:     1500,
			elapsedTime:    1600,
			elevationGain:  50,
		},
		{
			id:             1004,
			userID:         "test-user",
			name:           "Morning Yoga",
			activityType:   "Workout",
			sport:          "Yoga",
			startDateLocal: time.Date(2024, 1, 15, 6, 0, 0, 0, time.UTC),
			year:           2024,
			distance:       0,
			movingTime:     3600,
			elapsedTime:    3700,
			elevationGain:  0,
		},
	}

	for _, a := range testActivities {
		_, err := tx.Exec(ctx, `
			INSERT INTO desirelines.activities (
				id, user_id, name, type, sport, start_date_local, year,
				distance, moving_time, elapsed_time, total_elevation_gain
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`,
			a.id, a.userID, a.name, a.activityType, a.sport, a.startDateLocal, a.year,
			a.distance, a.movingTime, a.elapsedTime, a.elevationGain,
		)
		if err != nil {
			t.Fatalf("failed to insert test activity %d: %v", a.id, err)
		}
	}
}
