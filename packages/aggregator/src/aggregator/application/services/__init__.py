from functools import lru_cache

from aggregator.adapters.gcp import (
    make_write_distances,
    make_write_pacings,
    make_write_summary,
)
from aggregator.application.services._export_service import ExportService
from aggregator.application.services._pacing_service import PacingService


@lru_cache(maxsize=1)
def make_pacing_service() -> PacingService:
    return PacingService()


def make_export_service(config) -> ExportService:
    return ExportService(
        write_summary=lambda: make_write_summary(config),
        write_distances=lambda: make_write_distances(config),
        write_pacings=lambda: make_write_pacings(config),
    )


__all__ = [
    "ExportService",
    "PacingService",
    "make_export_service",
    "make_pacing_service",
]
