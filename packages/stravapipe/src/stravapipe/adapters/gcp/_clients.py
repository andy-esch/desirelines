from collections.abc import Sequence
import logging
from typing import TypedDict

from google.cloud.bigquery import (
    ArrayQueryParameter,
    QueryJobConfig,
    ScalarQueryParameter,
)
from google.cloud.bigquery import Client as BigQueryClient

from stravapipe.exceptions import BigQueryError

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

    def execute_query(
        self,
        query: str,
        query_parameters: Sequence[ScalarQueryParameter | ArrayQueryParameter]
        | None = None,
    ) -> list:
        """Execute a SELECT query and return the result rows.

        Args:
            query: SQL query string with optional @param placeholders
            query_parameters: List of BigQuery query parameters

        Returns:
            List of BigQuery Row objects
        """
        job_config = QueryJobConfig(
            query_parameters=query_parameters if query_parameters else []
        )
        result = self._client.query(query, job_config=job_config).result()
        return list(result)

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
        job_config = QueryJobConfig(
            query_parameters=query_parameters if query_parameters else []
        )
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
                "rows_affected": getattr(job, "num_dml_affected_rows", 0),
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
        job_config = QueryJobConfig(
            query_parameters=query_parameters if query_parameters else []
        )
        job = self._client.query(query, job_config=job_config)

        try:
            _ = job.result()
            rows_affected = getattr(job, "num_dml_affected_rows", 0)
        except Exception as e:
            logger.exception("DML query failed")
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
