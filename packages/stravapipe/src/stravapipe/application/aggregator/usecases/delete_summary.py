"""Delete summary use case"""

from collections.abc import Callable
import logging

from stravapipe.adapters import Supplier
from stravapipe.application.aggregator.services.export_service import ExportService
from stravapipe.application.aggregator.services.pacing_service import PacingService
from stravapipe.domain import MinimalStravaActivity, WebhookRequest
from stravapipe.exceptions import ActivityNotFoundError
from stravapipe.ports.out.read import ReadActivitiesMetadata, ReadSummaries
from stravapipe.types import SummaryObject

logger = logging.getLogger(__name__)


class DeleteSummaryUseCase:
    """Remove activity from summary JSON and recalculate cumulative distances"""

    def __init__(
        self,
        read_metadata: Supplier[ReadActivitiesMetadata],
        read_summaries: Supplier[ReadSummaries],
        pacing_service: Callable[[], PacingService],
        export_service: Callable[[], ExportService],
    ):
        """Initialize delete summary use case.

        Args:
            read_metadata: Factory for BigQuery metadata reader
            read_summaries: Factory for summary JSON reader (Cloud Storage)
            pacing_service: Factory for cumulative distance calculator
            export_service: Factory for Cloud Storage exporter
        """
        self._read_metadata = read_metadata()
        self._read_summaries = read_summaries()
        self._pacing_service = pacing_service()
        self._export_service = export_service()

    @staticmethod
    def _remove_from_summary(
        summary: SummaryObject, activity: MinimalStravaActivity
    ) -> SummaryObject:
        """Remove activity from summary for specific date.

        Args:
            summary: Year's activity summary (dict of date → SummaryEntry)
            activity: Activity to remove

        Returns:
            Updated summary

        Raises:
            ActivityNotFoundError: If activity not in summary (noisy failure)
        """
        if activity.date_str not in summary:
            logger.error(
                "Activity %s date %s not in summary - possible missed create/update event",
                activity.id,
                activity.date_str,
            )
            raise ActivityNotFoundError(
                activity.id,
                f"Activity {activity.id} not found in summary for date {activity.date_str}",
            )

        day_data = summary[activity.date_str]

        if activity.id not in day_data["activity_ids"]:
            logger.error(
                "Activity %s not in activity_ids for date %s - possible missed create/update event",
                activity.id,
                activity.date_str,
            )
            raise ActivityNotFoundError(
                activity.id,
                f"Activity {activity.id} not in summary for date {activity.date_str}",
            )

        # Remove activity ID
        day_data["activity_ids"].remove(activity.id)

        # Subtract distance
        day_data["distance_miles"] -= activity.distance_miles

        # Remove day if no activities remain (decision 2025-10-12: remove empty days)
        if not day_data["activity_ids"]:
            del summary[activity.date_str]
            logger.info("Removed empty day %s from summary", activity.date_str)

        return summary

    def run(self, webhook_request: WebhookRequest) -> None:
        """Remove activity from summary and recalculate cumulative distances.

        Args:
            webhook_request: Delete webhook with activity ID

        Raises:
            ActivityNotFoundError: If activity not found in BigQuery or summary
        """
        activity_id = webhook_request.object_id

        # 1. Get activity metadata from BigQuery (handles race condition with UNION)
        activity = self._read_metadata.read_activity_metadata(activity_id)

        # 2. Filter by activity type (decision 2025-10-12: same as create/update)
        if activity.type not in ("Ride", "VirtualRide"):
            logger.info(
                "Skipping delete for non-Ride activity=%s, type=%s",
                activity.id,
                activity.type,
            )
            return

        # 3. Load year summary
        summary = self._read_summaries.read_activity_summary_by_year(
            activity.start_date_local.year
        )

        # 4. Remove from summary (raises ActivityNotFoundError if not found)
        updated_summary = self._remove_from_summary(summary, activity)

        # 5. Recalculate cumulative distances (PacingService rebuilds from scratch)
        distances_payload = self._pacing_service.calculate(
            updated_summary, year=activity.start_date_local.year
        )

        # 6. Export all three JSON files
        self._export_service.export(
            summary=updated_summary,
            distances_payload=distances_payload,
            year=activity.start_date_local.year,
        )

        logger.info("Delete complete for activity_id=%s", activity.id)
