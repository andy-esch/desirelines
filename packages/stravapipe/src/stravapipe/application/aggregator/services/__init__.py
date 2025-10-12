"""Aggregator services for data processing."""

from functools import lru_cache
from typing import TYPE_CHECKING

from stravapipe.application.aggregator.services.export_service import ExportService
from stravapipe.application.aggregator.services.pacing_service import PacingService

if TYPE_CHECKING:
    from stravapipe.config.aggregator import AggregatorConfig


@lru_cache(maxsize=1)
def make_pacing_service() -> PacingService:
    return PacingService()


def make_export_service(config: "AggregatorConfig") -> ExportService:
    from stravapipe.adapters.gcp import (
        make_write_distances,
        make_write_pacings,
        make_write_summary,
    )

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
