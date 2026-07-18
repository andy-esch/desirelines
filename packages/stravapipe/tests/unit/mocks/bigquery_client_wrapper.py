from collections.abc import Sequence
from typing import Any

from stravapipe.adapters.gcp._clients import BigQueryClientWrapper, MergeResult


class MockBigQueryClientWrapper(BigQueryClientWrapper):
    def __init__(self, *, project_id: str):
        self.project_id: str = project_id
        self.executed_queries: list[str] = []
        self.query_stats: MergeResult = {
            "rows_affected": 1,
            "execution_time_ms": 100,
            "job_id": "test-job-id",
            "query_preview": "test-query",
        }

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
