"""Update summary use case"""

from collections.abc import Callable
import logging

from aggregator.adapters import OneArgSupplier, Supplier
from aggregator.application.services import ExportService, PacingService
from aggregator.config import AggregatorConfig
from aggregator.domain import StravaActivity, SummaryObject, WebhookRequest
from aggregator.ports.out.read import ReadActivities, ReadStravaToken, ReadSummaries

logger = logging.getLogger(__name__)


class UpdateSummaryUseCase:
    """Update summary data"""

    def __init__(
        self,
        config: AggregatorConfig,
        read_activities: OneArgSupplier[ReadActivities],
        read_summaries: Supplier[ReadSummaries],
        read_strava_token: Supplier[ReadStravaToken],
        pacing_service: Callable[[], PacingService],
        export_service: Callable[[], ExportService],
    ):
        refreshed_token_set = read_strava_token().refresh
        self._read_activities = read_activities(refreshed_token_set)
        self._read_summaries = read_summaries
        self._pacing_service = pacing_service()
        self._export_service = export_service()

    # TODO move to update service
    @staticmethod
    def _update_summary(
        summary: SummaryObject, activity: StravaActivity
    ) -> SummaryObject | None:
        if activity.date_str in summary:
            if activity.id in summary[activity.date_str]["activity_ids"]:
                return None
            summary[activity.date_str]["distance_miles"] += activity.distance_miles
            summary[activity.date_str]["activity_ids"].append(activity.id)
        else:
            summary[activity.date_str] = {
                "distance_miles": activity.distance_miles,
                "activity_ids": [activity.id],
            }
        return summary

    def run(self, webhook_request: WebhookRequest) -> None:
        """Real-time process to update summary data"""
        # fetch new activity
        activity = self._read_activities.read_activity_by_id(webhook_request.object_id)
        if activity.type not in ("Ride", "VirtualRide"):
            logger.info(
                "Skipping activity=%s, not in allowed type. %s posted, "
                "expecting Ride or VirtualRide",
                activity.id,
                activity.type,
            )
            return
        # fetch summary activities
        summary = self._read_summaries().read_activity_summary_by_year(
            activity.start_date_local.year
        )

        # merge in activity to summary
        updated_summary = self._update_summary(summary, activity)
        if updated_summary is None:
            logger.info("Activity already logged, exiting...")
            return
        distances_payload, pacings_payload = self._pacing_service.calculate(
            updated_summary, year=activity.start_date_local.year
        )

        # post updated summary to blob
        self._export_service.export(
            summary=updated_summary,
            distances_payload=distances_payload,
            pacings_payload=pacings_payload,
            year=activity.start_date_local.year,
        )
        logger.info("Update complete for activity_id = %s", activity.id)

    def run_batch(self, year: int) -> None:
        """Generate and overwrite (if it exists) a year's summary activities"""
        # read all activities in a year
        all_activities = self._read_activities.read_activities_by_year(year)
        summary: SummaryObject = {}
        for activity in all_activities:
            temp = self._update_summary(summary, activity)
            if temp is not None:
                summary = temp

        distances_payload, pacings_payload = self._pacing_service.calculate(
            summary, year=year
        )

        # post updated summary to blob
        self._export_service.export(
            summary=summary,
            distances_payload=distances_payload,
            pacings_payload=pacings_payload,
            year=year,
        )

        logger.info("Update complete for year = %s", year)
