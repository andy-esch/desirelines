"""Update summary use case"""

from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timezone
import logging

from stravapipe.adapters import OneArgSupplier, Supplier
from stravapipe.application.aggregator.services.export_service import ExportService
from stravapipe.application.aggregator.services.pacing_service import PacingService
from stravapipe.config.sport_config import load_sport_config
from stravapipe.domain import MinimalStravaActivity, WebhookRequest
from stravapipe.ports.out.read import (
    ReadMinimalActivities,
    ReadStravaToken,
    ReadSummaries,
)
from stravapipe.types.generated.sports_metrics_pb2 import (
    DailyActivity,
    DailySummary,
    YearMetadata,
)

logger = logging.getLogger(__name__)


class UpdateSummaryUseCase:
    """Update summary data"""

    def __init__(
        self,
        read_activities: OneArgSupplier[ReadMinimalActivities],
        read_summaries: Supplier[ReadSummaries],
        read_strava_token: Supplier[ReadStravaToken],
        pacing_service: Callable[[], PacingService],
        export_service: Callable[[], ExportService],
    ):
        refreshed_token_set = read_strava_token().refresh()
        self._read_activities = read_activities(refreshed_token_set)
        self._read_summaries = read_summaries
        self._pacing_service = pacing_service()
        self._export_service = export_service()
        self._sport_config = load_sport_config()

    # TODO move to update service
    # TODO update this so the logic is clearer. IMO a none-return doesn't
    #      logically translate that it's not updated it
    @staticmethod
    def _update_summary(
        summary: DailySummary, activity: MinimalStravaActivity
    ) -> DailySummary | None:
        """Update summary with new activity data.

        Args:
            summary: DailySummary protobuf message containing daily map
            activity: Activity to add

        Returns:
            Updated summary protobuf, or None if activity was already logged
        """
        if activity.date_str in summary.daily:
            daily = summary.daily[activity.date_str]
            if activity.id in daily.activity_ids:
                return None
            # Update existing day
            daily.distance_meters += activity.distance
            daily.time_minutes += activity.moving_time / 60.0
            daily.elevation_meters += activity.total_elevation_gain
            daily.activities += 1
            daily.activity_ids.append(activity.id)
        else:
            # Create new day entry
            daily = summary.daily[activity.date_str]
            daily.distance_meters = activity.distance
            daily.time_minutes = activity.moving_time / 60.0
            daily.elevation_meters = activity.total_elevation_gain
            daily.activities = 1
            daily.activity_ids.append(activity.id)
        return summary

    def run(self, webhook_request: WebhookRequest) -> None:
        """Real-time process to update summary data"""
        # Fetch new activity
        activity = self._read_activities.read_activity_by_id(webhook_request.object_id)

        # Categorize by sport (config-driven)
        sport = self._sport_config.categorize_activity(activity.type)
        if sport is None:
            logger.info(
                "Skipping activity=%s, unconfigured type: %s",
                activity.id,
                activity.type,
            )
            return

        logger.info(
            "Processing activity=%s as sport=%s (type=%s)",
            activity.id,
            sport,
            activity.type,
        )

        # Fetch summary for this sport
        summary = self._read_summaries().read_activity_summary_by_year_and_sport(
            year=activity.start_date_local.year,
            sport=sport,
        )

        # Merge in activity to summary
        updated_summary = self._update_summary(summary, activity)
        if updated_summary is None:
            logger.info("Activity already logged, exiting...")
            return

        distances_payload = self._pacing_service.calculate(
            updated_summary, year=activity.start_date_local.year
        )

        # Export updated summary to sport-specific file
        self._export_service.export(
            summary=updated_summary,
            distances_payload=distances_payload,
            year=activity.start_date_local.year,
            sport=sport,
        )

        logger.info("Update complete for activity_id=%s, sport=%s", activity.id, sport)

    def run_batch(
        self, year: int, activities: list[MinimalStravaActivity] | None = None
    ) -> None:
        """Generate and overwrite (if it exists) a year's summary activities

        Now generates separate files per sport.

        Args:
            year: The year to generate summaries for
            activities: Optional pre-fetched activities. If provided, uses these instead
                       of fetching from Strava API. Useful for backfills to avoid
                       duplicate API calls.
        """
        # Use provided activities or fetch from Strava
        if activities is not None:
            logger.info("Using %s pre-fetched activities", len(activities))
            all_activities = activities
        else:
            logger.info("Fetching activities from Strava for year %s", year)
            all_activities = self._read_activities.read_activities_by_year(year)

        # Group activities by sport
        sport_activities = self._categorize_by_sport(all_activities)

        logger.info(
            "Categorized %s activities into %s sports: %s",
            len(all_activities),
            len(sport_activities),
            list(sport_activities.keys()),
        )

        # Process each sport separately
        for sport, sport_acts in sport_activities.items():
            logger.info("Processing %s activities for sport=%s", len(sport_acts), sport)

            # Build summary for this sport (DailySummary protobuf)
            summary = DailySummary()
            for activity in sport_acts:
                temp = self._update_summary(summary, activity)
                if temp is not None:
                    summary = temp

            distances_payload = self._pacing_service.calculate(summary.daily, year=year)

            # Export to sport-specific file
            self._export_service.export(
                summary=summary,
                distances_payload=distances_payload,
                year=year,
                sport=sport,
            )

        # Generate metadata file
        self._write_metadata(year=year, sport_activities=sport_activities)

        logger.info("Batch update complete for year=%s", year)

    def _categorize_by_sport(
        self, activities: list[MinimalStravaActivity]
    ) -> dict[str, list[MinimalStravaActivity]]:
        """Group activities by sport.

        Args:
            activities: List of all activities

        Returns:
            Dict mapping sport name to list of activities
        """
        sport_activities = defaultdict(list)

        for activity in activities:
            sport = self._sport_config.categorize_activity(activity.type)
            if sport is None:
                logger.debug("Skipping unconfigured activity type: %s", activity.type)
                continue
            sport_activities[sport].append(activity)

        return dict(sport_activities)

    def _write_metadata(
        self, year: int, sport_activities: dict[str, list[MinimalStravaActivity]]
    ) -> None:
        """Write year metadata file with sport totals.

        Args:
            year: Year
            sport_activities: Dict mapping sport to activities
        """
        logger.info("Writing metadata for year=%s", year)

        metadata = YearMetadata()
        metadata.year = year
        metadata.aggregation_version = "1.0"
        metadata.last_updated = datetime.now(timezone.utc).isoformat()

        # Add sports and compute totals
        for sport, activities in sport_activities.items():
            metadata.sports.append(sport)

            category = self._sport_config.get_category(sport)
            totals = metadata.totals[sport]

            totals.activities = len(activities)

            # Distance (already in meters from Strava)
            if category.has_distance:
                total_distance = sum(a.distance for a in activities if a.distance)
                totals.distance_meters = total_distance

            # Time (convert seconds to minutes)
            total_time_minutes = sum(a.moving_time / 60.0 for a in activities if a.moving_time)
            totals.time_minutes = total_time_minutes

            # Elevation (already in meters from Strava)
            if category.has_elevation:
                total_elevation = sum(
                    a.total_elevation_gain for a in activities if a.total_elevation_gain
                )
                totals.elevation_meters = total_elevation

        # Write metadata file
        self._export_service.export_metadata(metadata, year=year)
