from stravapipe.adapters import Supplier
from stravapipe.ports.out.write import WriteDistances, WriteMetadata, WriteSummary
from stravapipe.types import DistanceTimeseries
from stravapipe.types.generated.sports_metrics_pb2 import DailySummary, YearMetadata


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
        distances_payload: dict[str, DistanceTimeseries],
        year: int,
        sport: str,
    ):
        """Export data for a specific sport.

        Args:
            summary: DailySummary protobuf message
            distances_payload: Distance timeseries data
            year: Year
            sport: Sport name
        """
        self._write_summary().update(summary, year=year, sport=sport)
        self._write_distances().update(distances_payload, year=year, sport=sport)

    def export_metadata(self, metadata: YearMetadata, *, year: int) -> None:
        """Export year metadata with sport totals.

        Args:
            metadata: YearMetadata protobuf message
            year: Year
        """
        self._write_metadata().update(metadata, year=year)
