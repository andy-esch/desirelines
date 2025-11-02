"""Type definitions for stravapipe.

This package contains:
- generated/ - Protocol buffer generated types (NEW - use these for new code)
- legacy.py - Legacy TypedDict types (DEPRECATED - will be removed)
"""

# Re-export legacy types for backward compatibility
# TODO: Remove these once migration to protobuf types is complete
from stravapipe.types.legacy import (
    DistanceTimeseries,
    SummaryEntry,
    SummaryObject,
    TimeseriesEntry,
)

__all__ = [
    "SummaryEntry",
    "TimeseriesEntry",
    "SummaryObject",
    "DistanceTimeseries",
]
