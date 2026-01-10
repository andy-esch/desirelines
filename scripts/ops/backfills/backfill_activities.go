package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"time"

	"cloud.google.com/go/bigquery"
	"google.golang.org/api/iterator"
)

// Hardcoded constants for prod-only script
const (
	sourceProject    = "progressor-341702"
	sourceDataset    = "strava"
	sourceTable      = "activities"
	targetProject    = "desirelines-prod"
	targetDataset    = "desirelines"
	targetTable      = "activities"
	dispatcherURL    = "https://us-central1-desirelines-prod.cloudfunctions.net/desirelines_dispatcher"
	subscriptionID   = 305683
	defaultRateLimit = 0.2 // requests per second
)

// Config holds the script configuration
type Config struct {
	StartDate string
	EndDate   string
	Limit     int
	DryRun    bool
	Verbose   bool
	RateLimit float64
}

// StravaWebhookEvent represents the webhook payload format
type StravaWebhookEvent struct {
	ObjectType     string         `json:"object_type"`
	ObjectID       int64          `json:"object_id"`
	AspectType     string         `json:"aspect_type"`
	OwnerID        int64          `json:"owner_id"`
	SubscriptionID int            `json:"subscription_id"`
	EventTime      int64          `json:"event_time"`
	Updates        map[string]any `json:"updates"` // Empty dict for "create" events
}

// ActivityRow represents an activity from BigQuery
type ActivityRow struct {
	ID        int64     `bigquery:"missing_activity_id"`
	AthleteID int64     `bigquery:"athlete_id"`
	StartDate time.Time `bigquery:"start_date"`
}

func main() {
	config := parseFlags()

	ctx := context.Background()

	// Phase 1: Query for missing activities (gets all details in one query)
	log.Println("Phase 1: Querying for missing activities...")
	activities, err := queryMissingActivities(ctx, config)
	if err != nil {
		log.Fatalf("Failed to query missing activities: %v", err)
	}

	if len(activities) == 0 {
		log.Println("No missing activities found. Exiting.")
		return
	}

	log.Printf("Found %d missing activities", len(activities))

	if config.DryRun {
		log.Println("Dry run mode - would process the following activities:")
		for i, activity := range activities {
			if i >= 10 {
				log.Printf("... and %d more", len(activities)-10)
				break
			}
			log.Printf("  - Activity ID %d (athlete %d, date %s)",
				activity.ID, activity.AthleteID, activity.StartDate.Format("2006-01-02"))
		}
		return
	}

	// Phase 2: Transform to webhook events
	log.Println("Phase 2: Transforming to webhook events...")
	events := transformToWebhookEvents(activities)

	// Phase 3: Replay webhooks
	log.Println("Phase 3: Replaying webhook events...")
	if err := replayWebhooks(ctx, config, events); err != nil {
		log.Fatalf("Failed to replay webhooks: %v", err)
	}

	log.Printf("Successfully replayed %d webhook events", len(events))
}

func parseFlags() *Config {
	config := &Config{}

	flag.StringVar(&config.StartDate, "start-date", "", "Start date (YYYY-MM-DD)")
	flag.StringVar(&config.EndDate, "end-date", "", "End date (YYYY-MM-DD)")
	flag.IntVar(&config.Limit, "limit", 0, "Max activities to process (0 = unlimited)")
	flag.BoolVar(&config.DryRun, "dry-run", false, "Preview without executing")
	flag.BoolVar(&config.Verbose, "verbose", false, "Verbose logging")
	flag.Float64Var(&config.RateLimit, "rate-limit", defaultRateLimit, "Requests per second")

	flag.Parse()

	return config
}

func queryMissingActivities(ctx context.Context, config *Config) ([]ActivityRow, error) {
	client, err := bigquery.NewClient(ctx, sourceProject)
	if err != nil {
		return nil, fmt.Errorf("failed to create BigQuery client: %w", err)
	}
	defer client.Close()

	// Single query gets all needed data: ID, athlete_id, start_date
	query := fmt.Sprintf(`
		SELECT
			pr.id as missing_activity_id,
			pr.athlete.id as athlete_id,
			pr.start_date
		FROM %s.%s.%s AS pr
		LEFT JOIN %s.%s.%s AS de
		ON pr.id = de.id
		WHERE de.id IS NULL
	`, sourceProject, sourceDataset, sourceTable,
		targetProject, targetDataset, targetTable)

	// Add date filters if provided
	if config.StartDate != "" && config.EndDate != "" {
		query += fmt.Sprintf(`
			AND pr.start_date >= '%s'
			AND pr.start_date < '%s'
		`, config.StartDate, config.EndDate)
	} else if config.StartDate != "" {
		query += fmt.Sprintf("\n\t\t\tAND pr.start_date >= '%s'", config.StartDate)
	} else if config.EndDate != "" {
		query += fmt.Sprintf("\n\t\t\tAND pr.start_date < '%s'", config.EndDate)
	}

	// Add limit if provided
	if config.Limit > 0 {
		query += fmt.Sprintf("\n\t\tLIMIT %d", config.Limit)
	}

	if config.Verbose {
		log.Printf("Query:\n%s\n", query)
	}

	q := client.Query(query)
	it, err := q.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to execute query: %w", err)
	}

	var activities []ActivityRow
	for {
		var row ActivityRow
		err := it.Next(&row)
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to read query results: %w", err)
		}
		activities = append(activities, row)
	}

	return activities, nil
}

func transformToWebhookEvents(activities []ActivityRow) []StravaWebhookEvent {
	events := make([]StravaWebhookEvent, len(activities))
	for i, activity := range activities {
		events[i] = StravaWebhookEvent{
			ObjectType:     "activity",
			ObjectID:       activity.ID,
			AspectType:     "create",
			OwnerID:        activity.AthleteID,
			SubscriptionID: subscriptionID,
			EventTime:      activity.StartDate.Unix(),
			Updates:        make(map[string]any), // Empty dict for create events
		}
	}
	return events
}

func replayWebhooks(ctx context.Context, config *Config, events []StravaWebhookEvent) error {
	// Calculate delay between requests based on rate limit
	delayBetweenRequests := time.Duration(float64(time.Second) / config.RateLimit)

	successCount := 0
	errorCount := 0

	for i, event := range events {
		if err := postWebhook(ctx, event); err != nil {
			log.Printf("Error posting webhook for activity %d: %v", event.ObjectID, err)
			errorCount++
		} else {
			successCount++
			if config.Verbose {
				log.Printf("[%d/%d] Posted webhook for activity %d", i+1, len(events), event.ObjectID)
			}
		}

		// Rate limiting: sleep between requests (except after last one)
		if i < len(events)-1 {
			time.Sleep(delayBetweenRequests)
		}
	}

	log.Printf("Replay complete: %d successful, %d errors", successCount, errorCount)

	if errorCount > 0 {
		return fmt.Errorf("encountered %d errors during replay", errorCount)
	}

	return nil
}

func postWebhook(ctx context.Context, event StravaWebhookEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal webhook event: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", dispatcherURL, bytes.NewBuffer(payload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to post webhook: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned non-success status: %d", resp.StatusCode)
	}

	return nil
}
