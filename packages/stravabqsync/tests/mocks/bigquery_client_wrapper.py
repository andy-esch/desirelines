from stravabqsync.adapters.gcp._clients import BigQueryClientWrapper


class MockBigQueryClientWrapper(BigQueryClientWrapper):
    def __init__(self, *, project_id: str):
        self.project_id: str = project_id
        self.table_name: str | None = None
        self.dataset_name: str | None = None
        self.written_activities: list[dict] | None = None

    def insert_rows_json(
        self, rows: list[dict], *, dataset_name: str, table_name: str
    ) -> None:
        self.written_activities = rows
        self.table_name = table_name
        self.dataset_name = dataset_name
