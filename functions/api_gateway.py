"""
API Gateway Cloud Function - Secure access to chart data

Provides REST API endpoints for serving chart data from private Cloud Storage bucket.
Replaces direct public bucket access for security.

Endpoints:
- GET /health - Health check
- GET /activities/{year}/summary - Activity summary data
- GET /activities/{year}/distances - Chart distance data
- GET /activities/{year}/pacings - Pacing analysis data
"""

import json
import logging
import os
from pathlib import Path
from typing import Any

import functions_framework
from google.cloud import storage
from google.cloud.storage.blob import Blob

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATA_SOURCE = os.environ.get("DATA_SOURCE", "cloud-storage")  # "cloud-storage" or "local-fixtures"
FIXTURES_PATH = os.environ.get("FIXTURES_PATH", "/app/data/fixtures")

# Initialize storage client (reused across invocations, only for cloud mode)
PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "local-dev")
storage_client = storage.Client(project=PROJECT_ID) if DATA_SOURCE == "cloud-storage" else None
BUCKET_NAME = os.environ.get("GCP_BUCKET_NAME", "desirelines_local_testing")


def _get_cors_headers() -> dict[str, str]:
    """Standard CORS headers for API responses"""
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
    }


def _fetch_local_fixture(file_path: str) -> tuple[dict[str, Any] | None, int]:
    """Fetch JSON data from local fixtures directory"""
    try:
        full_path = Path(FIXTURES_PATH) / file_path

        if not full_path.exists():
            logger.warning(f"Fixture file not found: {full_path}")
            return None, 404

        with open(full_path, 'r') as f:
            data = json.load(f)

        logger.info(f"Successfully loaded fixture: {file_path}")
        return data, 200

    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in fixture {file_path}: {e}")
        return None, 500
    except Exception as e:
        logger.error(f"Error loading fixture {file_path}: {e}")
        return None, 500


def _fetch_blob_data(blob_name: str) -> tuple[dict[str, Any] | None, int]:
    """Fetch JSON data from Cloud Storage blob"""
    try:
        bucket = storage_client.bucket(BUCKET_NAME)
        blob: Blob = bucket.blob(blob_name)

        if not blob.exists():
            logger.warning(f"Blob not found: {blob_name}")
            return None, 404

        data = json.loads(blob.download_as_text())
        logger.info(f"Successfully fetched blob: {blob_name}")
        return data, 200

    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in blob {blob_name}: {e}")
        return None, 500
    except Exception as e:
        logger.error(f"Error fetching blob {blob_name}: {e}")
        return None, 500


def _fetch_data(resource_path: str) -> tuple[dict[str, Any] | None, int]:
    """Fetch data from configured source (local fixtures or cloud storage)"""
    if DATA_SOURCE == "local-fixtures":
        return _fetch_local_fixture(resource_path)
    else:
        return _fetch_blob_data(resource_path)


@functions_framework.http
def main(request):
    """API Gateway Cloud Function - handles all chart data endpoints"""

    # Handle CORS preflight
    if request.method == "OPTIONS":
        return "", 204, _get_cors_headers()

    # Only allow GET requests
    if request.method != "GET":
        return {"error": "Method not allowed"}, 405, _get_cors_headers()

    path = request.path.lstrip("/")
    logger.info(f"API request: {request.method} /{path}")

    try:
        # Health check endpoint
        if path == "health":
            health_data = {
                "status": "healthy",
                "data_source": DATA_SOURCE,
            }
            if DATA_SOURCE == "cloud-storage":
                health_data["bucket"] = BUCKET_NAME
            else:
                health_data["fixtures_path"] = FIXTURES_PATH

            return health_data, 200, _get_cors_headers()

        # Parse activity data endpoints: activities/{year}/{data_type}
        path_parts = path.split("/")
        if len(path_parts) == 3 and path_parts[0] == "activities":
            year = path_parts[1]
            data_type = path_parts[2]

            # Map endpoints to blob names
            blob_mapping = {
                "summary": f"activities/{year}/summary_activities.json",
                "distances": f"activities/{year}/distances.json",
                "pacings": f"activities/{year}/pacings.json",
            }

            if data_type not in blob_mapping:
                return (
                    {
                        "error": "Invalid data type",
                        "valid_types": list(blob_mapping.keys()),
                    },
                    400,
                    _get_cors_headers(),
                )

            resource_path = blob_mapping[data_type]
            data, status_code = _fetch_data(resource_path)

            if status_code != 200:
                if status_code == 404:
                    return (
                        {"error": f"Data not found for {year}/{data_type}"},
                        404,
                        _get_cors_headers(),
                    )
                else:
                    return {"error": "Internal server error"}, 500, _get_cors_headers()

            # Add caching headers for successful responses
            headers = _get_cors_headers()
            headers["Cache-Control"] = "public, max-age=300"  # 5 minutes
            headers["Content-Type"] = "application/json"

            return data, 200, headers

        # Unknown endpoint
        return (
            {
                "error": "Not found",
                "available_endpoints": [
                    "/health",
                    "/activities/{year}/summary",
                    "/activities/{year}/distances",
                    "/activities/{year}/pacings",
                ],
            },
            404,
            _get_cors_headers(),
        )

    except Exception as e:
        logger.error(f"Unexpected API error: {e}")
        return {"error": "Internal server error"}, 500, _get_cors_headers()
