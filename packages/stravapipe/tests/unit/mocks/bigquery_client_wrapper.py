from stravapipe.adapters.gcp._clients import BigQueryClientWrapper


class MockBigQueryClientWrapper(BigQueryClientWrapper):
    def __init__(self, *, project_id: str):
        self.project_id: str = project_id
        self.table_name: str | None = None
        self.dataset_name: str | None = None
        self.written_activities: list[dict] | None = None
        self.executed_queries: list[str] = []
        self.query_stats: dict = {"rows_affected": 1, "execution_time_ms": 100}

    def insert_rows_json(
        self, rows: list[dict], *, dataset_name: str, table_name: str
    ) -> None:
        self.written_activities = rows
        self.table_name = table_name
        self.dataset_name = dataset_name

    def execute_merge_query(self, query: str) -> dict:
        """Mock implementation of execute_merge_query for testing"""
        self.executed_queries.append(query)
        return self.query_stats
