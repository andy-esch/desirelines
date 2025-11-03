from stravapipe.application.aggregator.services.export_service import ExportService
from stravapipe.types.generated.sports_metrics_pb2 import DailySummary, YearMetadata


class MockExportService(ExportService):
    def __init__(self):
        self.results = None
        self.year = None
        self.sport = None
        self.metadata = None

    def export(
        self,
        *,
        summary: DailySummary,
        distances_payload: dict,
        year: int,
        sport: str,
    ) -> None:
        self.results = summary
        self.year = year
        self.sport = sport

    def export_metadata(self, metadata: YearMetadata, *, year: int) -> None:
        """Export year metadata with sport totals."""
        self.metadata = metadata
        self.year = year
