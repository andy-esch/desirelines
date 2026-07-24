from datetime import UTC, datetime
import json
from pathlib import Path

import pytest

from stravapipe.domain import (
    DetailedStravaActivity,
    MetaAthlete,
    StandardActivity,
    is_non_geographic_activity,
)


@pytest.fixture
def activity_json_1():
    fixture_path = Path(__file__).parent.parent.parent / "fixtures" / "activity_1.json"
    with fixture_path.open(encoding="utf-8") as fin:
        return json.load(fin)


@pytest.fixture
def activity_json_2():
    fixture_path = Path(__file__).parent.parent.parent / "fixtures" / "activity_2.json"
    with fixture_path.open(encoding="utf-8") as fin:
        return json.load(fin)


class TestStravaActivity:
    def test_strava_activity_id_1(self, activity_json_1):
        activity = DetailedStravaActivity(**activity_json_1)

        assert activity.id == 12345678987654321

    def test_strava_activity_id_2(self, activity_json_2):
        activity = DetailedStravaActivity(**activity_json_2)

        assert activity.id == 8726373550


@pytest.mark.parametrize(
    ("type_", "sport_type", "trainer", "manual", "expected"),
    [
        ("Ride", "Ride", False, False, False),
        ("Ride", "VirtualRide", False, False, True),
        ("VirtualRide", "VirtualRide", False, False, True),
        ("VirtualRun", "Run", False, False, True),
        ("Run", "Run", True, False, True),
        ("Run", "Run", False, True, True),
    ],
)
def test_is_non_geographic_activity(
    type_: str,
    sport_type: str,
    trainer: bool,
    manual: bool,
    expected: bool,
):
    """The shared predicate covers modern, legacy, trainer, and manual cases."""
    activity = StandardActivity(
        id=1,
        athlete=MetaAthlete(id=999, resource_state=1),
        name="x",
        type=type_,
        sport_type=sport_type,
        start_date_local=datetime(2024, 1, 1, tzinfo=UTC),
        distance=1.0,
        moving_time=1,
        elapsed_time=1,
        trainer=trainer,
        manual=manual,
    )

    assert is_non_geographic_activity(activity) is expected
