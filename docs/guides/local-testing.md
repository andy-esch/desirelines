# Local Testing Environment Setup

This guide helps you set up a local testing environment that connects to the live Strava API and writes data to a BigQuery table for ad hoc testing and development.

## 🎯 Overview

The local testing environment allows you to:
- Fetch real activity data from the Strava API
- Write data to a dedicated BigQuery testing table
- Test the complete pipeline end-to-end
- Experiment with data transformations safely

## 📋 Prerequisites

### 1. Google Cloud Setup
- A GCP project with BigQuery API enabled
- `gcloud` CLI installed and authenticated
- `bq` CLI available (comes with gcloud)

### 2. Strava API Credentials
You need the following from your Strava API application:
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET` 
- `STRAVA_REFRESH_TOKEN`

> **Getting Strava Credentials**: If you don't have these, see the [Strava API Documentation](https://developers.strava.com/docs/getting-started/) for setting up an application and obtaining OAuth tokens.

## 🚀 Quick Setup

### 1. Set Environment Variables

```bash
export GCP_PROJECT_ID="your-gcp-project"
export STRAVA_CLIENT_ID="your_client_id"
export STRAVA_CLIENT_SECRET="your_client_secret"
export STRAVA_REFRESH_TOKEN="your_refresh_token"
```

### 2. Run Setup Script

```bash
chmod +x scripts/setup_local_testing.sh
./scripts/setup_local_testing.sh
```

This script will:
- ✅ Create a BigQuery dataset (`local_testing`)
- ✅ Create an activities table with proper schema
- ✅ Generate a `.env` file for local development
- ✅ Configure authentication

## 🧪 Testing the Setup

### 1. Test Strava API Connection

```bash
uv run python scripts/test_strava_connection.py
```

This will:
- Refresh your Strava tokens
- Fetch a sample of your activities
- Verify API connectivity

### 2. Test BigQuery Write

```bash
uv run python scripts/test_bq_write.py
```

This will:
- Create a test activity record
- Write it to your BigQuery table
- Verify the write succeeded

### 3. End-to-End Pipeline Test

```bash
# Test with default settings (current year, 5 activities)
uv run python scripts/test_end_to_end.py

# Test specific year and limit
uv run python scripts/test_end_to_end.py --year 2024 --limit 10
```

This will:
- Fetch real activities from Strava
- Write them to BigQuery
- Show a summary of processed data

## 📊 BigQuery Table Structure

The testing table (`activities_adhoc`) uses the schema defined in `schemas/bigquery/activities_full.json`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER | Strava activity ID (primary key) |
| `athlete_id` | INTEGER | Strava athlete ID |
| `name` | STRING | Activity name/title |
| `distance_meters` | FLOAT | Distance in meters |
| `activity_type` | STRING | Activity type (Ride, Run, etc.) |
| `start_date` | TIMESTAMP | Activity start time (UTC) |
| `average_watts` | FLOAT | Average power output |
| `created_at` | TIMESTAMP | ETL timestamp |
| ... | ... | [Full schema](../../schemas/bigquery/activities_full.json) |

**Features:**
- ⚡ **Time partitioned** by `start_date` for efficient querying
- 🔍 **Optimized** for analytical queries
- 📝 **Well-documented** fields with clear descriptions

## 💡 Usage Examples

### Query Recent Activities

```sql
SELECT 
    name,
    activity_type,
    distance_meters / 1000 as distance_km,
    start_date
FROM `your-project.local_testing.activities_adhoc`
WHERE start_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
ORDER BY start_date DESC
LIMIT 10
```

### Power Analysis

```sql
SELECT 
    activity_type,
    AVG(average_watts) as avg_watts,
    MAX(average_watts) as max_watts,
    COUNT(*) as activity_count
FROM `your-project.local_testing.activities_adhoc`
WHERE average_watts IS NOT NULL
GROUP BY activity_type
ORDER BY avg_watts DESC
```

## 🔧 Configuration

### Environment Variables

The setup creates a `.env` file with these key variables:

```bash
# GCP Configuration  
GCP_PROJECT_ID=your-project-id
GCP_BIGQUERY_DATASET=local_testing

# Strava API (Live)
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret  
STRAVA_REFRESH_TOKEN=your_refresh_token

# Logging
LOG_LEVEL=INFO
```

### Customization

To use a different dataset or table:

```bash
export GCP_BIGQUERY_DATASET="my_custom_dataset"
./scripts/setup_local_testing.sh
```

## 🎛️ Advanced Usage

### Custom Data Processing

Create your own testing scripts by following the pattern in the example scripts:

```python
from stravabqsync.config import BQInserterConfig
from stravabqsync.application.services import make_sync_service

# Load config
config = BQInserterConfig()
sync_service = make_sync_service(config)

# Your custom logic here...
```

### Data Cleanup

To clean up test data:

```sql
DELETE FROM `your-project.local_testing.activities_adhoc`
WHERE id >= 999999999  -- Test activity IDs
```

## 🚨 Important Notes

### Cost Management
- **BigQuery**: Queries are charged based on data scanned
- **Strava API**: Has rate limits (100 requests per 15 minutes, 1000 per day)
- **Storage**: Minimal costs for testing data

### Data Privacy
- Test data may contain real activity information
- Use appropriate GCP IAM policies for access control
- Consider using a separate project for testing

### Rate Limiting
The Strava API has limits:
- **Short-term**: 100 requests per 15 minutes  
- **Daily**: 1000 requests per day

The testing scripts respect these limits but be mindful when running multiple tests.

## 🐛 Troubleshooting

### Common Issues

**"Permission denied" errors**
```bash
gcloud auth login
gcloud config set project your-project-id
```

**"Invalid refresh token"**
- Your Strava refresh token may have expired
- Re-authorize your Strava application

**"Table not found"**
- Run the setup script again
- Check that your GCP project has BigQuery enabled

**"Rate limit exceeded"**
- Wait 15 minutes and try again
- Reduce the `--limit` parameter in tests

### Getting Help

1. Check the logs for detailed error messages
2. Verify your environment variables are set correctly
3. Ensure your GCP project has the necessary APIs enabled
4. Confirm your Strava credentials are valid

## 🔗 Related Documentation

- [Strava API Documentation](https://developers.strava.com/docs/)
- [BigQuery Documentation](https://cloud.google.com/bigquery/docs)
- [Project Architecture](../CLAUDE.md)