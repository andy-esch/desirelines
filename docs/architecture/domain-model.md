# Domain Model

A cross-package glossary mapping core concepts to their type names in each package. Use this as a Rosetta Stone when tracing data through the pipeline.

## Data Flow

```
Strava API
  |
  v
dispatcher (Go) ── webhook receipt, activity enrichment
  |
  v  (Pub/Sub: EnrichedEvent as JSON)
stravapipe (Python) ── activity transformation, storage
  |
  v  (PostgreSQL + BigQuery)
apigateway (Go) ── read-only API serving
  |
  v  (JSON/Protobuf over HTTPS)
web (TypeScript) ── dashboard rendering
```

## Core Types by Package

### Activity

The central domain object. Represents a single Strava activity as it flows through the system.

| Stage | Package | Type | File |
|-------|---------|------|------|
| Strava API response (detailed) | stravapipe | `DetailedStravaActivity` | `packages/stravapipe/src/stravapipe/domain/activity.py` |
| Strava API response (summary) | stravapipe | `SummaryStravaActivity` | `packages/stravapipe/src/stravapipe/domain/activity.py` |
| Strava API response (minimal) | stravapipe | `MinimalStravaActivity` | `packages/stravapipe/src/stravapipe/domain/activity.py` |
| Normalized for DB write | stravapipe | `StandardActivity` | `packages/stravapipe/src/stravapipe/domain/activity.py` |
| Database table | PostgreSQL | `desirelines.activities` | `schemas/database/migrations/` |
| API response (full) | apigateway | `activitiesv1.Activity` | `packages/apigateway/types/generated/activitiesv1/activities.pb.go` |
| API response (list item) | apigateway | `activitiesv1.ActivitySummary` | `packages/apigateway/types/generated/activitiesv1/activities.pb.go` |
| Frontend | web | `Activity` | `packages/web/src/types/generated/activities.ts` |
| Frontend (list item) | web | `ActivitySummary` | `packages/web/src/types/generated/activities.ts` |

### Webhook Event

Represents a notification from Strava about an activity change.

| Stage | Package | Type | File |
|-------|---------|------|------|
| Proto definition | schemas | `WebhookEvent` | `schemas/proto/desirelines/webhook/v1/webhook.proto` |
| Incoming JSON | dispatcher | `StravaWebhookJSON` | `packages/dispatcher/adapters/proto/webhook_adapter.go` |
| Proto (Go) | dispatcher | `generated.WebhookEvent` | `packages/dispatcher/types/generated/webhook.pb.go` |
| Enriched with raw activity | dispatcher | `generated.EnrichedEvent` | `packages/dispatcher/types/generated/webhook.pb.go` |
| JSON for Pub/Sub | dispatcher | `EnrichedEventJSON` | `packages/dispatcher/adapters/proto/webhook_adapter.go` |
| Proto (Python) | stravapipe | `webhook_pb2.WebhookEvent` | `packages/stravapipe/src/stravapipe/types/generated/webhook_pb2.py` |
| Proto (Python) | stravapipe | `webhook_pb2.EnrichedEvent` | `packages/stravapipe/src/stravapipe/types/generated/webhook_pb2.py` |
| Pub/Sub envelope | stravapipe | `PubSubEnvelope` / `PubSubMessage` | `packages/stravapipe/src/stravapipe/cloudrun/pubsub.py` |

### Sport Configuration

Maps Strava activity types (e.g., `Ride`, `Run`) to application sport categories (e.g., `cycling`, `running`). Source of truth: `schemas/sports/sport_types.json`.

| Stage | Package | Type | File |
|-------|---------|------|------|
| Canonical schema | schemas | JSON file (16 sport categories) | `schemas/sports/sport_types.json` |
| Go config | apigateway | `config.SportConfig` / `config.SportCategory` | `packages/apigateway/config/sport_config.go` |
| Python schema validation | stravapipe | `SportConfigModel` / `SportCategoryModel` | `packages/stravapipe/src/stravapipe/config/sport_config.py` |
| Python runtime | stravapipe | `SportConfig` / `SportCategory` | `packages/stravapipe/src/stravapipe/config/sport_config.py` |
| Frontend (API response) | web | `SportConfig` | `packages/web/src/api/activities.ts` |

### Cumulative Metrics

Year-to-date cumulative metrics per sport (distance, time, elevation, activity count).

| Stage | Package | Type | File |
|-------|---------|------|------|
| Proto definition | schemas | `SportMetrics`, `CumulativeMetricsEntry` | `schemas/proto/desirelines/sports/v1/sports_metrics.proto` |
| Go (proto-generated) | apigateway | `SportMetrics`, `CumulativeMetricsEntry` | `packages/apigateway/types/generated/sports_metrics.pb.go` |
| Go (multi-sport) | apigateway | `AllSportsMetrics` | `packages/apigateway/types/generated/sports_metrics.pb.go` |
| Python (proto-generated) | stravapipe | `sports_metrics_pb2.SportMetrics` | `packages/stravapipe/src/stravapipe/types/generated/sports_metrics_pb2.py` |
| Frontend (proto-generated) | web | `SportMetrics`, `CumulativeMetricsEntry` | `packages/web/src/types/generated/sports_metrics.ts` |
| Frontend (multi-sport) | web | `AllSportsMetrics` | `packages/web/src/types/generated/sports_metrics.ts` |

### Daily Summary

Per-day activity breakdown used for bar charts and calendars.

| Stage | Package | Type | File |
|-------|---------|------|------|
| Proto definition | schemas | `DailyActivity`, `DailySummary` | `schemas/proto/desirelines/sports/v1/sports_metrics.proto` |
| Go (proto-generated) | apigateway | `DailyActivity`, `DailySummary`, `AllSportsDailySummary` | `packages/apigateway/types/generated/sports_metrics.pb.go` |
| Frontend (proto-generated) | web | `DailyActivity`, `DailySummary`, `AllSportsDailySummary` | `packages/web/src/types/generated/sports_metrics.ts` |

### Year Metadata

Per-year summary: available sports, totals, and aggregation version.

| Stage | Package | Type | File |
|-------|---------|------|------|
| Proto definition | schemas | `YearMetadata`, `SportMetadata`, `SportTotals` | `schemas/proto/desirelines/sports/v1/sports_metrics.proto` |
| Go (proto-generated) | apigateway | `YearMetadata`, `SportMetadata`, `SportTotals` | `packages/apigateway/types/generated/sports_metrics.pb.go` |
| Frontend (proto-generated) | web | `YearMetadata`, `SportMetadata`, `SportTotals` | `packages/web/src/types/generated/sports_metrics.ts` |

### User Configuration

User preferences, goals, and annotations. Stored in Firestore.

| Stage | Package | Type | File |
|-------|---------|------|------|
| Proto definition | schemas | `UserConfig`, `Preferences`, `Goal`, `Annotation` | `schemas/proto/desirelines/config/v1/user_config.proto` |
| Go (proto-generated) | apigateway | `UserConfig`, `Preferences`, `Goal`, `Annotation` | `packages/apigateway/types/generated/user_config.pb.go` |
| Frontend (proto-generated) | web | `UserConfig`, `Preferences`, `Goal`, `Annotation` | `packages/web/src/types/generated/user_config.ts` |
| Frontend (service layer) | web | `UserConfigService` | `packages/web/src/services/userConfigService.ts` |

### Strava Tokens

Per-user OAuth tokens for Strava API access. Stored in Firestore.

| Stage | Package | Type | File |
|-------|---------|------|------|
| Firestore document | shared | `stravatoken.Data` | `packages/shared/stravatoken/types.go` |
| OAuth exchange response | apigateway | `auth.StravaTokenResponse` | `packages/apigateway/internal/auth/types.go` |
| Token refresh | dispatcher | `strava.tokenResponse` (unexported) | `packages/dispatcher/adapters/strava/client.go` |
| Python token set | stravapipe | `StravaTokenSet` | `packages/stravapipe/src/stravapipe/domain/auth.py` |

### Activity Routes

Normalized GPS routes for map visualization.

| Stage | Package | Type | File |
|-------|---------|------|------|
| Database table | PostgreSQL | `desirelines.activity_routes` | `schemas/database/migrations/` |
| Go repository | apigateway | `repository.NormalizedRoute` | `packages/apigateway/repository/types.go` |
| Frontend | web | `NormalizedRoute` | `packages/web/src/api/routes.ts` |

## Shared Schemas

### Protobuf Definitions

All proto files live in `schemas/proto/desirelines/` and are the source of truth for cross-package types.

| Proto File | Used By | Purpose |
|------------|---------|---------|
| `webhook/v1/webhook.proto` | dispatcher, stravapipe | Webhook events, enriched events |
| `sports/v1/sports_metrics.proto` | apigateway, web | Metrics, daily summaries, year metadata |
| `activities/v1/activities.proto` | apigateway, web | Activity list/detail API contracts |
| `config/v1/user_config.proto` | apigateway, web | User preferences, goals, annotations |

### JSON Schemas

| File | Used By | Purpose |
|------|---------|---------|
| `schemas/sports/sport_types.json` | apigateway, stravapipe, web (via API) | Canonical sport category registry |

### Shared Go Library

`packages/shared/` provides cross-cutting concerns used by both Go services:

| Package | Purpose |
|---------|---------|
| `gcplog` | Structured logging and standardized HTTP error responses (`APIError`) |
| `stravatoken` | Firestore document schema for Strava OAuth tokens (`Data`) |
| `ratelimit` | Per-IP rate limiting middleware |
| `secrets` | Secret loading from file mounts with env var fallback |
| `otel` | OpenTelemetry setup for GCP |

## Key Naming Differences

| Concept | Database Column | Go Field | Python Field | TypeScript Field |
|---------|----------------|----------|--------------|------------------|
| Activity type (Strava) | `type` | `Type` | `type` | `type` |
| Sport category (app) | `sport` | `Sport` | `sport` | `sport` |
| Start time | `start_date_local` | `StartDateLocal` | `start_date_local` | `startDateLocal` |
| Distance | `distance` (meters) | `DistanceMeters` | `distance` (meters) | `distanceMeters` |
| Moving time | `moving_time` (seconds) | `MovingTimeSeconds` | `moving_time` (seconds) | `movingTimeSeconds` |
| Elevation | `total_elevation_gain` (meters) | `ElevationMeters` | `total_elevation_gain` (meters) | `elevationMeters` |
| Average speed | `average_speed` (m/s) | `AverageSpeedMps` | `average_speed` (m/s) | `averageSpeedMps` |

## Enums

### MetricType

Defines the type of metric being tracked.

| Value | Proto | Go | Python | TypeScript |
|-------|-------|----|--------|------------|
| Distance (meters) | `METRIC_TYPE_DISTANCE_METERS` | `MetricType_METRIC_TYPE_DISTANCE_METERS` | `MetricType.METRIC_TYPE_DISTANCE_METERS` | `MetricType.DISTANCE_METERS` |
| Time (minutes) | `METRIC_TYPE_TIME_MINUTES` | `MetricType_METRIC_TYPE_TIME_MINUTES` | `MetricType.METRIC_TYPE_TIME_MINUTES` | `MetricType.TIME_MINUTES` |
| Elevation (meters) | `METRIC_TYPE_ELEVATION_METERS` | `MetricType_METRIC_TYPE_ELEVATION_METERS` | `MetricType.METRIC_TYPE_ELEVATION_METERS` | `MetricType.ELEVATION_METERS` |
| Activity count | `METRIC_TYPE_ACTIVITIES` | `MetricType_METRIC_TYPE_ACTIVITIES` | `MetricType.METRIC_TYPE_ACTIVITIES` | `MetricType.ACTIVITIES` |

### AspectType (Webhook)

| Value | Proto | Go/Python |
|-------|-------|-----------|
| Create | `ASPECT_TYPE_CREATE` | `AspectType_ASPECT_TYPE_CREATE` |
| Update | `ASPECT_TYPE_UPDATE` | `AspectType_ASPECT_TYPE_UPDATE` |
| Delete | `ASPECT_TYPE_DELETE` | `AspectType_ASPECT_TYPE_DELETE` |

### AnnotationType (User Config)

| Value | Proto | Go/Python | TypeScript |
|-------|-------|-----------|------------|
| Event | `ANNOTATION_TYPE_EVENT` | `AnnotationType_ANNOTATION_TYPE_EVENT` | `AnnotationType.EVENT` |
| Period | `ANNOTATION_TYPE_PERIOD` | `AnnotationType_ANNOTATION_TYPE_PERIOD` | `AnnotationType.PERIOD` |
| Note | `ANNOTATION_TYPE_NOTE` | `AnnotationType_ANNOTATION_TYPE_NOTE` | `AnnotationType.NOTE` |
