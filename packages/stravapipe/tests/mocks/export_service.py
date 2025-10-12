from stravapipe.application.aggregator.services.export_service import ExportService


class MockExportService(ExportService):
    def __init__(self):
        self.results = None
        self.year = None

    def export(
        self,
        *,
        summary: dict,
        distances_payload: dict,
        pacings_payload: dict,
        year: int,
    ) -> None:
        self.results = summary
        self.year = year
