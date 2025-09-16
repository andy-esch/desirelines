import logging

from google.cloud.bigquery import Client

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
