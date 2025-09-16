import json
from pathlib import Path

import pytest
from requests_mock import Mocker

from stravabqsync.adapters.strava._repositories import (
    StravaActivitiesRepo,
    StravaTokenRepo,
)
from stravabqsync.config import StravaApiConfig
from stravabqsync.domain import StravaActivity, StravaTokenSet
from stravabqsync.exceptions import (
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
def activities_repo(tokenset, api_config):
    return StravaActivitiesRepo(tokenset._replace(access_token="baz"), api_config)


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


class TestStravaActivitiesRepo:
    def test_read_activity_by_id(self, activities_repo, activity_json):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = (
                f"{activities_repo._api_config.api_base_url}/activities/{activity_id}"
            )
            m.get(endpoint, json=activity_json)
            resp = activities_repo.read_activity_by_id(activity_id)

        assert resp.id == activity_id

    def test_read_activity_by_id_type(self, activities_repo, activity_json):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = (
                f"{activities_repo._api_config.api_base_url}/activities/{activity_id}"
            )
            m.get(endpoint, json=activity_json)
            resp = activities_repo.read_activity_by_id(activity_id)

        assert isinstance(resp, StravaActivity)

    def test_read_activity_not_found(self, activities_repo, activity_json):
        activity_id = -10
        with Mocker() as m:
            endpoint = (
                f"{activities_repo._api_config.api_base_url}/activities/{activity_id}"
            )
            m.get(endpoint, status_code=404)
            with pytest.raises(ActivityNotFoundError):
                _ = activities_repo.read_activity_by_id(activity_id)

    def test_read_activity_token_expired(self, activities_repo):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = (
                f"{activities_repo._api_config.api_base_url}/activities/{activity_id}"
            )
            m.get(endpoint, status_code=401)
            with pytest.raises(StravaTokenError):
                _ = activities_repo.read_activity_by_id(activity_id)

    def test_read_activity_api_error(self, activities_repo):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = (
                f"{activities_repo._api_config.api_base_url}/activities/{activity_id}"
            )
            m.get(endpoint, status_code=500, text="Server Error")
            with pytest.raises(StravaApiError):
                _ = activities_repo.read_activity_by_id(activity_id)
