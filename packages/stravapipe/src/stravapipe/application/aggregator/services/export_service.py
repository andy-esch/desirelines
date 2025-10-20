from stravapipe.adapters import Supplier
from stravapipe.ports.out.write import WriteDistances, WriteSummary
from stravapipe.types import DistanceTimeseries, SummaryObject


class ExportService:
    def __init__(
        self,
        write_summary: Supplier[WriteSummary],
        write_distances: Supplier[WriteDistances],
    ):
        self._write_summary = write_summary
        self._write_distances = write_distances

    def export(
        self,
        *,
        summary: SummaryObject,
        distances_payload: dict[str, DistanceTimeseries],
        year: int,
    ):
        """Export data..."""
        self._write_summary().update(summary, year=year)
        self._write_distances().update(distances_payload, year=year)
