import json
from pathlib import Path

import pytest

from stravapipe.domain import DetailedStravaActivity


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
