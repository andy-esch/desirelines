"""Shared type definitions for output formats and data structures."""

from typing_extensions import TypedDict


# Aggregator output formats
class SummaryEntry(TypedDict):
    """Entry in daily activity summary.

    Stores cumulative distance and activity IDs for a single day.
    Used in the summary JSON blob structure.
    """

    distance_miles: float
    activity_ids: list[int]


class TimeseriesEntry(TypedDict):
    """Entry in timeseries data for visualization.

    Used for both distance and pacing timeseries charts.
    """

    x: str  # Date string (YYYY-MM-DD)
    y: float  # Value (distance or pacing)


# Type aliases for aggregator output formats
SummaryObject = dict[str, SummaryEntry]
DistanceTimeseries = list[TimeseriesEntry]
