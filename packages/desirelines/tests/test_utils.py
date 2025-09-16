from datetime import UTC, date, datetime

import pytest

from desirelines.utils import date_range, num_days_in_year, num_days_so_far


class TestNumDaysInYear:
    def test_non_leap_year(self):
        assert num_days_in_year(2023) == 365

    def test_num_days_leap_year(self):
        assert num_days_in_year(2024) == 366


class TestNumDaysSoFar:
    def test_current_year(self):
        curr_year = datetime.now(tz=UTC).date().year
        assert 0 <= num_days_so_far(curr_year) <= 366

    @pytest.mark.parametrize(
        ("year", "expected"),
        [(2020, 366), (2021, 365), (2022, 365)],
    )
    def test_usage(self, year, expected):
        assert num_days_so_far(year) == expected

    def test_future_year(self):
        with pytest.raises(ValueError, match="has not occurred yet"):
            num_days_so_far(3023)


class TestDateRange:
    def test_num_elements(self):
        assert len(list(date_range(2023))) == 365

    def test_num_unique_elements(self):
        assert len(list(set(date_range(2023)))) == 365

    def test_type(self):
        assert all(isinstance(val, tuple) for val in date_range(2023))

    def test_type_elements_dates(self):
        assert all(isinstance(date_val, date) for date_val, _ in date_range(2023))

    def test_type_elements_strs(self):
        assert all(isinstance(date_str, str) for _, date_str in date_range(2023))
