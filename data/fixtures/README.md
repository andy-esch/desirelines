# Web UI Development Fixtures

This directory contains local fixture data for developing the React web UI without requiring live API Gateway access.

## Data Source
Copied from `progressor-341702` project (legacy production system) on 2025-10-03.
- **Total files**: 338
- **Total size**: ~6.2MB
- **Date range**: 2023-2025

## Directory Structure

```
fixtures/
└── activities/           # Aggregated summary data by year
    ├── 2023/
    │   ├── distances.json          # Distance aggregations
    │   ├── pacings.json            # Pacing aggregations
    │   └── summary_activities.json # Daily activity summaries
    ├── 2024/
    │   └── (same structure)
    └── 2025/
        └── (same structure)
```

## Data Formats

### summary_activities.json
Daily aggregated activity data:
```json
{
  "2024-01-02": {
    "distance_miles": 1.143382937,
    "activity_ids": [10481812565]
  }
}
```

### distances.json
Distance-based aggregations (format TBD - inspect file for structure)

### pacings.json
Pacing-based aggregations (format TBD - inspect file for structure)

## Usage for Web UI Development

### Local API Gateway Mode
The API Gateway can be configured to serve this fixture data locally:

**Environment variable:**
```bash
DATA_SOURCE=local-fixtures
FIXTURES_PATH=/path/to/data/fixtures
```

**Docker Compose:**
```yaml
services:
  api-gateway:
    environment:
      - DATA_SOURCE=local-fixtures
      - FIXTURES_PATH=/app/data/fixtures
    volumes:
      - ./data/fixtures:/app/data/fixtures:ro
```

### Web UI Integration
The React app should:
1. Use the same API client regardless of backend (local vs cloud)
2. Configure API base URL via environment variable
3. Expect the same response format from local and cloud APIs

## Next Steps
- [ ] Inspect `distances.json` and `pacings.json` structure
- [ ] Update API Gateway to support local fixture mode
- [ ] Configure web UI to connect to local API Gateway
- [ ] Document API endpoints and response formats
