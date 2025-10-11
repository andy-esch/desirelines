"""Aggregator use cases for webhook processing."""

from stravapipe.adapters import OneArgSupplier, Supplier
from stravapipe.application.aggregator.services.export_service import ExportService
from stravapipe.application.aggregator.services.pacing_service import PacingService
from stravapipe.application.aggregator.usecases.update_summary import (
    UpdateSummaryUseCase,
)
from stravapipe.ports.out.read import ReadMinimalActivities, ReadStravaToken, ReadSummaries


def make_update_summary_use_case(
    read_activities: OneArgSupplier[ReadMinimalActivities],
    read_summaries: Supplier[ReadSummaries],
    read_strava_token: Supplier[ReadStravaToken],
    pacing_service: Supplier[PacingService],
    export_service: Supplier[ExportService],
) -> UpdateSummaryUseCase:
    return UpdateSummaryUseCase(
        read_activities=read_activities,
        read_summaries=read_summaries,
        read_strava_token=read_strava_token,
        pacing_service=pacing_service,
        export_service=export_service,
    )


__all__ = [
    "UpdateSummaryUseCase",
    "make_update_summary_use_case",
]
