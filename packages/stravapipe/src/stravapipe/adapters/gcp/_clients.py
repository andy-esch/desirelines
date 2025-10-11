import json
import logging
from typing import Any

from google.cloud.bigquery import Client as BigQueryClient
from google.cloud.bigquery import QueryJobConfig
from google.cloud.storage import Client as StorageClient

from stravapipe.exceptions import BigQueryError

logger = logging.getLogger(__name__)


class BigQueryClientWrapper:
    def __init__(self, *, project_id: str):
        self.project_id = project_id
        self._client = BigQueryClient(project=project_id)

    def insert_rows_json(
        self, rows: list[dict], *, dataset_name: str, table_name: str
    ) -> None:
        """Insert each dict in rows as a new row in `dataset.table_name`
        https://cloud.google.com/bigquery/docs/samples/bigquery-table-insert-rows#bigquery_table_insert_rows-python
        """
        table_id = f"{self.project_id}.{dataset_name}.{table_name}"
        errors = self._client.insert_rows_json(table_id, rows)
        if len(errors) > 0:
            logger.error("BigQuery insertion errors for %s: %s", table_id, errors)
            raise BigQueryError(
                f"Failed to insert {len(rows)} rows into {table_id}", errors
            )
        logger.info("Successfully inserted %s rows into %s.", len(rows), table_id)

    def execute_merge_query(self, query: str) -> dict:
        """Execute MERGE query for upsert operations

        Returns:
            dict: Job statistics including rows affected, execution time, etc.
        """
        job_config = QueryJobConfig()
        job = self._client.query(query, job_config=job_config)

        try:
            _ = job.result()  # Wait for completion

            # Calculate execution time in milliseconds
            execution_time_ms = None
            if job.ended and job.started:
                execution_time_ms = int(
                    (job.ended - job.started).total_seconds() * 1000
                )

            # Extract statistics
            stats = {
                "rows_affected": getattr(job, "num_dml_affected_rows", 0),
                "execution_time_ms": execution_time_ms,
                "job_id": job.job_id,
                "query_preview": query[:200],
            }

            logger.info(
                "MERGE operation completed successfully",
                extra={
                    "operation": "bigquery_merge",
                    "job_id": stats["job_id"],
                    "rows_affected": stats["rows_affected"],
                    "execution_time_ms": stats["execution_time_ms"],
                },
            )

            return stats

        except Exception as e:
            logger.error("MERGE operation failed: %s", str(e))
            raise BigQueryError(f"Failed to execute MERGE query: {e!s}") from e


class CloudStorageClientWrapper:
    """Cloud Storage client wrapper"""

    def __init__(self, *, project_id: str, bucket_name: str):
        self._client = StorageClient(project=project_id)
        self._bucket = self._client.bucket(bucket_name)

    def read_json_from_bucket(self, blob_name: str) -> dict[str, Any]:
        """Read a JSON blob from a bucket"""
        blob = self._bucket.blob(blob_name)
        return json.loads(blob.download_as_bytes())

    def write_json_to_bucket(
        self,
        data: dict | list,
        blob_name: str,
    ) -> None:
        """Write a JSON blob to a bucket"""
        blob = self._bucket.blob(blob_name)
        blob.upload_from_string(
            data=json.dumps(data), content_type="application/json"
        )

    def download_blob_to_file(self, blob_name: str, file_path: str) -> None:
        """Download a blob to a local file"""
        blob = self._bucket.blob(blob_name)
        blob.download_to_filename(file_path)

    def upload_file_to_blob(self, file_path: str, blob_name: str) -> None:
        """Upload a local file to a blob"""
        blob = self._bucket.blob(blob_name)
        blob.upload_from_filename(file_path)
