from collections.abc import Sequence
from typing import Any

from stravapipe.adapters.gcp._clients import BigQueryClientWrapper, MergeResult


class MockBigQueryClientWrapper(BigQueryClientWrapper):
    def __init__(self, *, project_id: str):
        self.project_id: str = project_id
        self.table_name: str | None = None
        self.dataset_name: str | None = None
        self.written_activities: list[dict] | None = None
        self.executed_queries: list[str] = []
        self.query_results: list = []
        self.query_stats: MergeResult = {
            "rows_affected": 1,
            "execution_time_ms": 100,
            "job_id": "test-job-id",
            "query_preview": "test-query",
        }

    def execute_query(
        self, query: str, query_parameters: Sequence[Any] | None = None
    ) -> list:
        """Mock implementation of execute_query for testing"""
        self.executed_queries.append(query)
        return self.query_results

    def insert_rows_json(
        self, rows: list[dict], *, dataset_name: str, table_name: str
    ) -> None:
        self.written_activities = rows
        self.table_name = table_name
        self.dataset_name = dataset_name

    def execute_merge_query(
        self, query: str, query_params: Sequence[Any] | None = None
    ) -> MergeResult:
        """Mock implementation of execute_merge_query for testing"""
        self.executed_queries.append(query)
        return self.query_stats

    def execute_dml_query(
        self, query: str, query_parameters: Sequence[Any] | None = None
    ) -> int:
        """Mock implementation of execute_dml_query for testing"""
        self.executed_queries.append(query)
        return 1
