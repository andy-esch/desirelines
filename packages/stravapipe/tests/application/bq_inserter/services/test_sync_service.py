from functools import lru_cache
import json
from pathlib import Path

import pytest

from stravapipe.application.bq_inserter.sync_service import SyncService
from stravapipe.domain import DetailedStravaActivity, StravaTokenSet
from tests.mocks.read_activities_repo import MockReadActivitiesRepo
from tests.mocks.read_token_repo import MockStravaTokenRepo
from tests.mocks.write_activities import MockWriteActivitesRepo


def _load_activity():
    """Load activity data from fixture file."""
    fixture_path = (
        Path(__file__).parent.parent.parent.parent / "fixtures" / "activity_2.json"
    )
    with open(fixture_path, encoding="utf-8") as fin:
        activity_data = json.load(fin)
    # NOTE: id = 8726373550
    return DetailedStravaActivity(**activity_data)


@pytest.fixture
def activity():
    return _load_activity()


def mock_token_repo():
    tokenset = StravaTokenSet(
        client_id=1, client_secret="foo", refresh_token="bar", access_token="baz"
    )
    return MockStravaTokenRepo(tokenset)


def mock_read_activities_repo(tokens: StravaTokenSet):
    return MockReadActivitiesRepo(_load_activity())


@lru_cache(maxsize=1)
def mock_write_activities_repo():
    return MockWriteActivitesRepo()


@pytest.fixture
def service():
    return SyncService(
        read_strava_token=mock_token_repo,
        read_activities=mock_read_activities_repo,
        write_activities=mock_write_activities_repo,
    )


class TestSyncService:
    def test_usage(self, service, activity):
        service.run(activity.id)
        assert service._write_activities.activity.id == 8726373550

    def test_write_activity_uses_upsert(self, service, activity):
        service.run(activity.id)
        assert service._write_activities.activity.id == 8726373550
