import json
from pathlib import Path

import pytest
from requests_mock import Mocker
from stravapipe.adapters.strava._repositories import (
    DetailedStravaActivitiesRepo,
    StravaTokenRepo,
)
from stravapipe.config import StravaApiConfig
from stravapipe.domain import DetailedStravaActivity, StravaTokenSet
from stravapipe.exceptions import (
    ActivityNotFoundError,
    StravaApiError,
    StravaTokenError,
)


@pytest.fixture
def tokenset():
    return StravaTokenSet(
        client_id=1, client_secret="foo", refresh_token="bar", access_token=None
    )


@pytest.fixture
def api_config():
    return StravaApiConfig()


@pytest.fixture
def activity_json():
    fixture_path = Path(__file__).parent.parent.parent / "fixtures" / "activity_1.json"
    with open(fixture_path, encoding="utf-8") as fin:
        activity_json = json.load(fin)
    # NOTE: id = 12345678987654321
    return activity_json


@pytest.fixture
def token_repo(tokenset, api_config):
    return StravaTokenRepo(tokens=tokenset, api_config=api_config)


@pytest.fixture
def detailed_activities_repo(tokenset, api_config):
    return DetailedStravaActivitiesRepo(
        tokenset._replace(access_token="baz"), api_config
    )


class TestStravaTokenRepo:
    def test_refresh(self, token_repo):
        with Mocker() as m:
            m.post(token_repo._api_config.token_url, json={"access_token": "baz"})
            expected = token_repo.refresh()
            assert expected.access_token == "baz"

    def test_failed_request(self, token_repo):
        with Mocker() as m:
            m.post(token_repo._api_config.token_url, status_code=401)

            with pytest.raises(StravaTokenError):
                token_repo.refresh()

    def test_failed_request_non_401(self, token_repo):
        with Mocker() as m:
            m.post(
                token_repo._api_config.token_url, status_code=500, text="Server Error"
            )

            with pytest.raises(StravaApiError):
                token_repo.refresh()


class TestDetailedStravaActivitiesRepo:
    def test_read_activity_by_id(self, detailed_activities_repo, activity_json):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{detailed_activities_repo._api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)
            resp = detailed_activities_repo.read_activity_by_id(activity_id)

        assert resp.id == activity_id

    def test_read_activity_by_id_type(self, detailed_activities_repo, activity_json):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{detailed_activities_repo._api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)
            resp = detailed_activities_repo.read_activity_by_id(activity_id)

        assert isinstance(resp, DetailedStravaActivity)

    def test_read_activity_not_found(self, detailed_activities_repo, activity_json):
        activity_id = -10
        with Mocker() as m:
            endpoint = f"{detailed_activities_repo._api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, status_code=404)
            with pytest.raises(ActivityNotFoundError):
                _ = detailed_activities_repo.read_activity_by_id(activity_id)

    def test_read_activity_token_expired(self, detailed_activities_repo):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{detailed_activities_repo._api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, status_code=401)
            with pytest.raises(StravaTokenError):
                _ = detailed_activities_repo.read_activity_by_id(activity_id)

    def test_read_activity_api_error(self, detailed_activities_repo):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = (
                f"{detailed_activities_repo._api_config.api_base_url}/activities/{activity_id}"
            )
            m.get(endpoint, status_code=500, text="Server Error")
            with pytest.raises(StravaApiError):
                _ = detailed_activities_repo.read_activity_by_id(activity_id)
