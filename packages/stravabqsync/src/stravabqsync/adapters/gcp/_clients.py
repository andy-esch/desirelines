import logging

from google.cloud.bigquery import Client, QueryJobConfig

from stravabqsync.exceptions import BigQueryError

logger = logging.getLogger(__name__)


class BigQueryClientWrapper:
    def __init__(self, *, project_id: str):
        self.project_id = project_id
        self._client = Client(project=project_id)

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
            result = job.result()  # Wait for completion

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
            raise BigQueryError(f"Failed to execute MERGE query: {str(e)}")
