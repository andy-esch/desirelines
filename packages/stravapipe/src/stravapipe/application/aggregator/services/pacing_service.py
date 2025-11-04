import datetime
from functools import lru_cache
import logging

import pytz

from stravapipe.types import DistanceTimeseries
from stravapipe.types.generated.sports_metrics_pb2 import DailySummary
from stravapipe.utils import date_range, num_days_in_year, num_days_so_far

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def today() -> datetime.datetime:
    """Datetime of today"""
    return datetime.datetime.now(pytz.timezone("America/New_York"))


class PacingService:
    """Generate pacing time series data based on targets"""

    @staticmethod
    def _translate_summary_for_chart(
        summary: DailySummary, year: int
    ) -> DistanceTimeseries:
        cumulative_sum: float = 0.0
        chart_data: DistanceTimeseries = []
        for date, date_str in date_range(year):
            if date > today().date():
                break
            if date_str in summary.daily:
                # Convert meters to miles for chart display
                distance_miles = summary.daily[date_str].distance_meters * 0.000621371
                cumulative_sum += distance_miles
            chart_data.append({"x": date_str, "y": cumulative_sum})

        return chart_data

    def calculate(
        self, summary: DailySummary, *, year: int, pacing_granularity: int = 500
    ) -> dict[str, DistanceTimeseries]:
        """Calculate pacings data from year summary data

        Args:
            summary: DailySummary protobuf message
            year: Year to calculate for
            pacing_granularity: Granularity for pacing calculations

        Returns:
            Dict with distance_traveled timeseries (in miles for display)
        """
        # Convert meters to miles for calculations
        total_distance = sum(
            val.distance_meters * 0.000621371 for val in summary.daily.values()
        )
        estimated_distance = (
            num_days_in_year(year) * total_distance / num_days_so_far(year)
        )
        logger.info(
            "Estimated distance for year %s: %s miles", year, estimated_distance
        )
        distance_traveled = self._translate_summary_for_chart(summary, year)
        distance_payload = {"distance_traveled": distance_traveled}
        return distance_payload
