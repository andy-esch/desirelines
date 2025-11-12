from stravapipe.adapters import Supplier
from stravapipe.ports.out.write import WriteDistances, WriteMetadata, WriteSummary
from stravapipe.types.generated.sports_metrics_pb2 import (
    CumulativeMetricsEntry,
    DailySummary,
    YearMetadata,
)


class ExportService:
    def __init__(
        self,
        write_summary: Supplier[WriteSummary],
        write_distances: Supplier[WriteDistances],
        write_metadata: Supplier[WriteMetadata],
    ):
        self._write_summary = write_summary
        self._write_distances = write_distances
        self._write_metadata = write_metadata

    def export(
        self,
        *,
        summary: DailySummary,
        cumulative_metrics: list[CumulativeMetricsEntry],
        year: int,
        sport: str,
    ):
        """Export data for a specific sport.

        Args:
            summary: DailySummary protobuf message
            cumulative_metrics: List of CumulativeMetricsEntry protobuf messages
            year: Year
            sport: Sport name
        """
        self._write_summary().update(summary, year=year, sport=sport)
        self._write_distances().update(cumulative_metrics, year=year, sport=sport)

    def export_metadata(self, metadata: YearMetadata, *, year: int) -> None:
        """Export year metadata with sport totals.

        Args:
            metadata: YearMetadata protobuf message
            year: Year
        """
        self._write_metadata().update(metadata, year=year)
