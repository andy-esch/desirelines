import json
from pathlib import Path

import pytest

from stravabqsync.domain import StravaActivity


@pytest.fixture
def activity_json_1():
    fixture_path = Path(__file__).parent / "fixtures" / "activity_1.json"
    with open(fixture_path, encoding="utf-8") as fin:
        activity = json.load(fin)
    return activity


@pytest.fixture
def activity_json_2():
    fixture_path = Path(__file__).parent / "fixtures" / "activity_2.json"
    with open(fixture_path, encoding="utf-8") as fin:
        activity = json.load(fin)
    return activity


class TestStravaActivity:
    def test_strava_activity_id_1(self, activity_json_1):
        activity = StravaActivity(**activity_json_1)

        assert activity.id == 12345678987654321

    def test_strava_activity_id_2(self, activity_json_2):
        activity = StravaActivity(**activity_json_2)

        assert activity.id == 8726373550
