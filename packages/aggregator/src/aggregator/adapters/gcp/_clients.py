import json
import logging
from typing import Any

from google.cloud.storage import Client

from aggregator.config import AggregatorConfig
from aggregator.domain import TimeseriesEntry

logger = logging.getLogger(__name__)


class CloudStorageClientWrapper:
    """Cloud Storage client wrapper"""

    def __init__(self, config: AggregatorConfig):
        self._client = Client(project=config.gcp_project_id)
        self._bucket = self._client.bucket(config.gcp_bucket_name)

    def read_json_from_bucket(self, blob_name: str) -> dict[str, Any]:
        """Read a JSON blob from a bucket"""
        blob = self._bucket.blob(blob_name)
        return json.loads(blob.download_as_bytes())

    def write_json_to_bucket(
        self,
        summary: dict | list[TimeseriesEntry],
        blob_name: str,
    ) -> None:
        """Write a JSON blob to a bucket"""
        blob = self._bucket.blob(blob_name)
        blob.upload_from_string(
            data=json.dumps(summary), content_type="application/json"
        )

    def download_blob_to_file(self, blob_name: str, file_path: str) -> None:
        """Download a blob to a local file"""
        blob = self._bucket.blob(blob_name)
        blob.download_to_filename(file_path)

    def upload_file_to_blob(self, file_path: str, blob_name: str) -> None:
        """Upload a local file to a blob"""
        blob = self._bucket.blob(blob_name)
        blob.upload_from_filename(file_path)
