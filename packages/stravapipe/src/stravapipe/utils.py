"""Utility functions for date and time operations."""

from collections.abc import Generator
from datetime import UTC, date, datetime, timedelta


def num_days_in_year(year: int) -> int:
    """Get the number of days in a year"""
    return (date(year + 1, 1, 1) - date(year, 1, 1)).days


def num_days_so_far(year: int) -> int:
    """Get the number of days that have passed in a year
    If the year is a previous one, then all the days are returned
    for that year.
    """
    today = datetime.now(tz=UTC).date()
    if year < today.year:
        return num_days_in_year(year)
    if year > today.year:
        raise ValueError(f"Year {year} has not occurred yet! It's {today.year}!")
    return (today - date(year - 1, 12, 31)).days


def date_range(year: int) -> Generator[tuple[date, str]]:
    """Generator to get all dates in a specified year"""
    num_days = num_days_in_year(year)
    anchor_date = date(year, 1, 1)
    vals = (anchor_date + timedelta(days=offset) for offset in range(num_days))
    for val in vals:
        yield (val, val.strftime("%Y-%m-%d"))
