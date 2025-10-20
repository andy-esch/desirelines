import datetime
from functools import lru_cache
import logging

import pytz

from stravapipe.types import DistanceTimeseries, SummaryObject
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
        summary: SummaryObject, year: int
    ) -> DistanceTimeseries:
        cumulative_sum: float = 0.0
        chart_data: DistanceTimeseries = []
        for date, date_str in date_range(year):
            if date > today().date():
                break
            if date_str in summary:
                cumulative_sum += summary[date_str]["distance_miles"]
            chart_data.append({"x": date_str, "y": cumulative_sum})

        return chart_data

    def calculate(
        self, summary: SummaryObject, *, year: int, pacing_granularity: int = 500
    ) -> dict[str, DistanceTimeseries]:
        """Calculate pacings data from year summary data"""
        total_distance = sum(val["distance_miles"] for val in summary.values())
        estimated_distance = (
            num_days_in_year(year) * total_distance / num_days_so_far(year)
        )
        logger.info("Estimated distance for year %s: %s", year, estimated_distance)
        distance_traveled = self._translate_summary_for_chart(summary, year)
        distance_payload = {"distance_traveled": distance_traveled}
        return distance_payload
