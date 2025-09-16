from desirelines.adapters import Supplier
from desirelines.domain import DistanceTimeseries, PacingTimeseries
from desirelines.ports.out.write import WriteDistances, WritePacings, WriteSummary


class ExportService:
    def __init__(
        self,
        write_summary: Supplier[WriteSummary],
        write_distances: Supplier[WriteDistances],
        write_pacings: Supplier[WritePacings],
    ):
        self._write_summary = write_summary
        self._write_distances = write_distances
        self._write_pacings = write_pacings

    def export(
        self,
        *,
        summary: dict,
        distances_payload: DistanceTimeseries,
        pacings_payload: PacingTimeseries,
        year: int,
    ):
        """Export data..."""
        self._write_summary().update(summary, year=year)
        self._write_distances().update(distances_payload, year=year)
        self._write_pacings().update(pacings_payload, year=year)
