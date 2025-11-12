"""Delete summary use case"""

from collections.abc import Callable
import logging

from stravapipe.adapters import Supplier
from stravapipe.application.aggregator.services.export_service import ExportService
from stravapipe.application.aggregator.services.pacing_service import PacingService
from stravapipe.config.sport_config import load_sport_config
from stravapipe.domain import MinimalStravaActivity, WebhookRequest
from stravapipe.exceptions import ActivityNotFoundError
from stravapipe.ports.out.read import ReadActivitiesMetadata, ReadSummaries
from stravapipe.types.generated.sports_metrics_pb2 import DailySummary

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
        self._sport_config = load_sport_config()

    @staticmethod
    def _remove_from_summary(
        summary: DailySummary, activity: MinimalStravaActivity
    ) -> DailySummary:
        """Remove activity from summary for specific date.

        Args:
            summary: DailySummary protobuf message
            activity: Activity to remove

        Returns:
            Updated summary

        Raises:
            ActivityNotFoundError: If activity not in summary (noisy failure)
        """
        if activity.date_str not in summary.daily:
            logger.error(
                "Activity %s date %s not in summary - possible missed create/update event",
                activity.id,
                activity.date_str,
            )
            raise ActivityNotFoundError(
                activity.id,
                f"Activity {activity.id} not found in summary for date {activity.date_str}",
            )

        daily = summary.daily[activity.date_str]

        if activity.id not in daily.activity_ids:
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
        daily.activity_ids.remove(activity.id)

        # Subtract metrics (all in meters/minutes)
        daily.distance_meters -= activity.distance
        daily.time_minutes -= activity.moving_time / 60.0
        daily.elevation_meters -= activity.total_elevation_gain
        daily.activities -= 1

        # Remove day if no activities remain (decision 2025-10-12: remove empty days)
        if not daily.activity_ids:
            del summary.daily[activity.date_str]
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

        # 2. Categorize by sport (config-driven)
        sport = self._sport_config.categorize_activity(activity.type)
        if sport is None:
            logger.info(
                "Skipping delete for unconfigured activity=%s, type=%s",
                activity.id,
                activity.type,
            )
            return

        logger.info(
            "Processing delete for activity=%s as sport=%s (type=%s)",
            activity.id,
            sport,
            activity.type,
        )

        # 3. Load sport-specific summary
        summary = self._read_summaries.read_activity_summary_by_year_and_sport(
            year=activity.start_date_local.year,
            sport=sport,
        )

        # 4. Remove from summary (raises ActivityNotFoundError if not found)
        updated_summary = self._remove_from_summary(summary, activity)

        # 5. Recalculate cumulative metrics (PacingService rebuilds from scratch)
        cumulative_metrics = self._pacing_service.calculate(
            summary=updated_summary, year=activity.start_date_local.year, sport=sport
        )

        # 6. Export updated sport-specific files
        self._export_service.export(
            summary=updated_summary,
            cumulative_metrics=cumulative_metrics,
            year=activity.start_date_local.year,
            sport=sport,
        )

        logger.info("Delete complete for activity_id=%s, sport=%s", activity.id, sport)
