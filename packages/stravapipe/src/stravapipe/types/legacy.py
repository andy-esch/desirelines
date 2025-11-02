"""Legacy type definitions for output formats and data structures.

NOTE: These types are deprecated and will be removed once migration to
protobuf-based types (sports_metrics_pb2) is complete.

Legacy types use miles (not meters) and TypedDict (not protobuf).
"""

from typing_extensions import TypedDict


# Aggregator output formats (LEGACY - uses miles)
class SummaryEntry(TypedDict):
    """Entry in daily activity summary.

    Stores cumulative distance and activity IDs for a single day.
    Used in the summary JSON blob structure.

    DEPRECATED: Use DailyActivity from sports_metrics_pb2 instead.
    """

    distance_miles: float
    activity_ids: list[int]


class TimeseriesEntry(TypedDict):
    """Entry in timeseries data for visualization.

    Used for both distance and pacing timeseries charts.

    DEPRECATED: Use TimeseriesEntry from sports_metrics_pb2 instead.
    Note: Protobuf version uses 'date' and 'value' instead of 'x' and 'y'.
    """

    x: str  # Date string (YYYY-MM-DD)
    y: float  # Value (distance or pacing)


# Type aliases for aggregator output formats
SummaryObject = dict[str, SummaryEntry]
DistanceTimeseries = list[TimeseriesEntry]

__all__ = [
    "SummaryEntry",
    "TimeseriesEntry",
    "SummaryObject",
    "DistanceTimeseries",
]
