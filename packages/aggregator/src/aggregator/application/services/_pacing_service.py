# TODO: pacing service
#       1. Average pacing for summary chart
#       2. Pacing bounds for summary chart
#       3. Pacing lines for pacings chart
import datetime
from functools import lru_cache
import logging

import pytz

from aggregator.domain import DistanceTimeseries, PacingTimeseries, SummaryObject
from aggregator.utils import date_range, num_days_in_year, num_days_so_far

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def today() -> datetime.datetime:
    """Datetime of today"""
    return datetime.datetime.now(pytz.timezone("America/New_York"))


class PacingService:
    """Generate pacing time series data based on targets"""

    @staticmethod
    def get_pacing_from_distance(
        end_of_year_distance: float, max_date: datetime.date, *, year: int
    ) -> PacingTimeseries:
        """Generate pacing lines given a target end-of-year distance"""
        num_days = num_days_in_year(year)
        pacing: PacingTimeseries = [
            {"x": date_str, "y": end_of_year_distance * float(idx + 1) / num_days}
            for idx, (date, date_str) in enumerate(date_range(year))
            if date <= max_date
        ]
        return pacing

    @staticmethod
    def _translate_summary_for_chart(
        summary: SummaryObject, year: int
    ) -> DistanceTimeseries:
        cumulative_sum = 0.0
        chart_data: DistanceTimeseries = []
        for date, date_str in date_range(year):
            if date > today().date():
                break
            if date_str in summary:
                cumulative_sum += summary[date_str]["distance_miles"]
            chart_data.append({"x": date_str, "y": cumulative_sum})

        return chart_data

    def _get_pacing(self, distances: DistanceTimeseries) -> PacingTimeseries:
        return [
            {"x": row["x"], "y": row["y"] / (idx + 1)}
            for idx, row in enumerate(distances)
        ]

    def _get_goal_pacing(
        self, goal: float, distances: DistanceTimeseries, year: int
    ) -> PacingTimeseries:
        vals: PacingTimeseries = [
            {
                "x": row["x"],
                "y": (goal - row["y"])
                / (
                    datetime.date(year + 1, 1, 1)
                    - datetime.datetime.strptime(row["x"], "%Y-%m-%d")
                    .replace(tzinfo=datetime.UTC)
                    .date()
                ).days,
            }
            for idx, row in enumerate(distances)
        ]
        vals = [
            {"x": row["x"], "y": row["y"] if row["y"] >= 0 else 0.0} for row in vals
        ]
        return vals

    def calculate(self, summary: dict, *, year: int, pacing_granularity: int = 500):
        """Calculate pacings data from year summary data"""
        total_distance = sum(val["distance_miles"] for val in summary.values())
        estimated_distance = (
            num_days_in_year(year) * total_distance / num_days_so_far(year)
        )
        logger.info("Estimated distance for year %s: %s", year, estimated_distance)
        max_date = (
            today().date() if year == today().year else datetime.date(year, 12, 31)
        )
        avg_distance = self.get_pacing_from_distance(
            estimated_distance, max_date, year=year
        )

        upper_distance_goal = (
            estimated_distance
            - (estimated_distance % pacing_granularity)
            + pacing_granularity
        )
        lower_distance_goal = estimated_distance - (
            estimated_distance % pacing_granularity
        )

        distance_traveled = self._translate_summary_for_chart(summary, year)
        upper_distance = self.get_pacing_from_distance(
            upper_distance_goal, max_date, year=year
        )
        lower_distance = self.get_pacing_from_distance(
            lower_distance_goal, max_date, year=year
        )
        distance_payload = {
            "distance_traveled": distance_traveled,
            "avg_distance": avg_distance,
            "upper_distance": upper_distance,
            "lower_distance": lower_distance,
            "summaries": {
                str(int(upper_distance_goal)): [f"{100} miles to go"],
                str(int(lower_distance_goal)): [],
            },
        }
        pacing_payload = {
            "pacing": self._get_pacing(distance_traveled),
            "upper_pacing": self._get_goal_pacing(
                upper_distance_goal, distance_traveled, year
            ),
            "lower_pacing": self._get_goal_pacing(
                lower_distance_goal, distance_traveled, year
            ),
            "summaries": {},
        }
        return distance_payload, pacing_payload
