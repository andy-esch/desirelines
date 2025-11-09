import datetime
import logging

import pytz

from stravapipe.config.sport_config import load_sport_config
from stravapipe.types.generated.sports_metrics_pb2 import (
    CumulativeMetricsEntry,
    DailySummary,
)
from stravapipe.utils import date_range

logger = logging.getLogger(__name__)


def today() -> datetime.datetime:
    """Datetime of today"""
    return datetime.datetime.now(pytz.timezone("America/New_York"))


class PacingService:
    """Generate cumulative metrics timeseries for chart rendering"""

    def __init__(self):
        self._sport_config = load_sport_config()

    def calculate(
        self, summary: DailySummary, *, year: int, sport: str
    ) -> list[CumulativeMetricsEntry]:
        """Build cumulative metrics timeseries from daily summary data

        Args:
            summary: DailySummary protobuf message with daily activity data
            year: Year to calculate for
            sport: Sport name (e.g., "cycling", "yoga")

        Returns:
            List of CumulativeMetricsEntry protobuf messages with cumulative totals
            Optional fields omitted if not applicable to sport
        """
        category = self._sport_config.get_category(sport)
        if category is None:
            logger.warning("Unknown sport category: %s", sport)
            return []

        entries: list[CumulativeMetricsEntry] = []

        # Track cumulative values
        cumulative_distance = 0.0
        cumulative_elevation = 0.0
        cumulative_time = 0.0
        cumulative_activities = 0

        # Build cumulative timeseries for each date in year (up to today)
        for date, date_str in date_range(year):
            if date > today().date():
                break

            # Add daily values if they exist
            if date_str in summary.daily:
                daily = summary.daily[date_str]

                if category.has_distance and daily.distance_meters:
                    cumulative_distance += daily.distance_meters

                if category.has_elevation and daily.elevation_meters:
                    cumulative_elevation += daily.elevation_meters

                if daily.time_minutes:
                    cumulative_time += daily.time_minutes

                cumulative_activities += daily.activities

            # Create entry for this date
            entry = CumulativeMetricsEntry()
            entry.date = date_str

            # Only set distance/elevation if applicable to sport (omit for yoga)
            # But always set time and activities (even if zero) for all sports
            if category.has_distance:
                entry.distance = cumulative_distance

            if category.has_elevation:
                entry.elevation = cumulative_elevation

            # Always set time and activities (these apply to all sports)
            entry.time = cumulative_time
            entry.activities = cumulative_activities

            entries.append(entry)

        logger.info(
            "Generated %s cumulative metrics entries for sport=%s, year=%s",
            len(entries),
            sport,
            year,
        )

        return entries
