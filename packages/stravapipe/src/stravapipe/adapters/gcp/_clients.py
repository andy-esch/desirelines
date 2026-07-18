from collections.abc import Sequence
import logging
from typing import Any, TypedDict

from google.api_core.exceptions import BadRequest
from google.cloud.bigquery import (
    ArrayQueryParameter,
    QueryJobConfig,
    ScalarQueryParameter,
)
from google.cloud.bigquery import Client as BigQueryClient

from stravapipe.exceptions import BigQueryError, StreamingBufferDMLError

# BigQuery's error message when a DML targets rows in the streaming buffer.
# Matched as a substring because the surrounding message includes the table
# name and verbiage that varies. Documented at:
#   https://cloud.google.com/bigquery/docs/reference/standard-sql/dml-syntax#limitations
_STREAMING_BUFFER_ERROR_FRAGMENT = "would affect rows in the streaming buffer"

logger = logging.getLogger(__name__)


class MergeResult(TypedDict):
    """Result from a BigQuery MERGE operation."""

    rows_affected: int
    execution_time_ms: int | None
    job_id: str
    query_preview: str


class BigQueryClientWrapper:
    def __init__(self, *, project_id: str):
        self.project_id = project_id
        self._client = BigQueryClient(project=project_id)

    def get_dataset(self, dataset_id: str) -> Any:
        """Fetch dataset metadata. Used as a lightweight readiness probe."""
        return self._client.get_dataset(dataset_id)

    def execute_merge_query(
        self,
        query: str,
        query_parameters: Sequence[ScalarQueryParameter | ArrayQueryParameter]
        | None = None,
    ) -> MergeResult:
        """Execute MERGE query for upsert operations

        Args:
            query: SQL query string with optional @param placeholders
            query_parameters: List of BigQuery query parameters for parameterized queries

        Returns:
            dict: Job statistics including rows affected, execution time, etc.
        """
        job_config = QueryJobConfig(query_parameters=query_parameters or [])
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
            stats: MergeResult = {
                # `num_dml_affected_rows` is present-and-None for non-row-affecting
                # statements; `or 0` collapses that to 0, matching the missing-attr case.
                "rows_affected": getattr(job, "num_dml_affected_rows", 0) or 0,
                "execution_time_ms": execution_time_ms,
                "job_id": str(job.job_id),
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

        except Exception as e:
            logger.exception("MERGE operation failed")
            raise BigQueryError(f"Failed to execute MERGE query: {e!s}") from e
        return stats

    def execute_dml_query(
        self,
        query: str,
        query_parameters: Sequence[ScalarQueryParameter | ArrayQueryParameter]
        | None = None,
    ) -> int:
        """Execute DML query (DELETE, INSERT, UPDATE).

        Args:
            query: SQL DML query string with optional @param placeholders
            query_parameters: List of BigQuery query parameters

        Returns:
            Number of rows affected
        """
        job_config = QueryJobConfig(query_parameters=query_parameters or [])
        job = self._client.query(query, job_config=job_config)

        try:
            _ = job.result()
            # `num_dml_affected_rows` is present-and-None for non-row-affecting
            # statements; `or 0` avoids int(None) TypeError outside the try block.
            rows_affected = getattr(job, "num_dml_affected_rows", 0) or 0
        except BadRequest as e:
            if _STREAMING_BUFFER_ERROR_FRAGMENT in str(e):
                # Expected condition: rows are still in BigQuery's streaming
                # buffer (~90 min after streaming insert). Don't log here —
                # the typed exception lets caller handle without alert noise.
                raise StreamingBufferDMLError(
                    f"DML rejected: rows in streaming buffer (job_id={job.job_id})"
                ) from e
            logger.exception("DML query failed", extra={"job_id": str(job.job_id)})
            raise BigQueryError(f"Failed to execute DML query: {e!s}") from e
        except Exception as e:
            logger.exception("DML query failed", extra={"job_id": str(job.job_id)})
            raise BigQueryError(f"Failed to execute DML query: {e!s}") from e
        logger.debug(
            "DML query completed",
            extra={
                "operation": "bigquery_dml",
                "rows_affected": rows_affected,
                "job_id": job.job_id,
            },
        )
        return int(rows_affected)
