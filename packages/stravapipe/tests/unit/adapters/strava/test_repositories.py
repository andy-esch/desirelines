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
    fixture_path = (
        Path(__file__).parent.parent.parent.parent / "fixtures" / "activity_1.json"
    )
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

    def test_read_activity_token_expired_after_refresh_retry(
        self, detailed_activities_repo
    ):
        """Test that 401 after token refresh raises StravaTokenError"""
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{detailed_activities_repo._api_config.api_base_url}/activities/{activity_id}"
            # First call returns 401, refresh succeeds, but retry also returns 401
            m.get(endpoint, status_code=401)
            m.post(
                detailed_activities_repo._api_config.token_url,
                json={"access_token": "new_token"},
            )
            with pytest.raises(StravaTokenError):
                _ = detailed_activities_repo.read_activity_by_id(activity_id)

    def test_read_activity_401_refresh_and_retry_succeeds(
        self, detailed_activities_repo, activity_json
    ):
        """Test that 401 triggers token refresh and successful retry"""
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{detailed_activities_repo._api_config.api_base_url}/activities/{activity_id}"
            # First call returns 401, then retry succeeds
            m.get(
                endpoint,
                [
                    {"status_code": 401},
                    {"json": activity_json, "status_code": 200},
                ],
            )
            m.post(
                detailed_activities_repo._api_config.token_url,
                json={"access_token": "new_token"},
            )
            resp = detailed_activities_repo.read_activity_by_id(activity_id)
            assert resp.id == activity_id
            # Verify token was refreshed
            assert detailed_activities_repo._current_access_token == "new_token"

    def test_read_activity_api_error(self, detailed_activities_repo):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{detailed_activities_repo._api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, status_code=500, text="Server Error")
            with pytest.raises(StravaApiError):
                _ = detailed_activities_repo.read_activity_by_id(activity_id)


class TestDetailedStravaActivitiesRepoAutoRefresh:
    """Tests for automatic token refresh behavior"""

    @pytest.fixture
    def repo_without_access_token(self, tokenset, api_config):
        """Create repo with no access_token (requires refresh)"""
        return DetailedStravaActivitiesRepo(tokenset, api_config)

    def test_auto_refresh_on_first_call(
        self, repo_without_access_token, activity_json, api_config
    ):
        """Test that missing access_token triggers automatic refresh"""
        activity_id = 12345678987654321
        with Mocker() as m:
            # Mock token refresh
            m.post(api_config.token_url, json={"access_token": "fresh_token"})
            # Mock activity endpoint
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)

            resp = repo_without_access_token.read_activity_by_id(activity_id)

            assert resp.id == activity_id
            assert repo_without_access_token._current_access_token == "fresh_token"
            # Verify token refresh was called
            assert m.call_count == 2  # 1 refresh + 1 activity

    def test_token_reused_across_calls(
        self, repo_without_access_token, activity_json, api_config
    ):
        """Test that refreshed token is reused for subsequent calls"""
        activity_id = 12345678987654321
        with Mocker() as m:
            # Mock token refresh (should only be called once)
            m.post(api_config.token_url, json={"access_token": "fresh_token"})
            # Mock activity endpoint
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)

            # First call
            repo_without_access_token.read_activity_by_id(activity_id)
            # Second call - should reuse token
            repo_without_access_token.read_activity_by_id(activity_id)

            # Token refresh called once, activity endpoint called twice
            assert m.call_count == 3  # 1 refresh + 2 activities

    def test_multiple_refreshes_over_time(self, tokenset, activity_json, api_config):
        """Test that the repo can handle multiple 401s over time (not just once)"""
        # Initialize WITH a token so we don't trigger the "first call auto-refresh"
        tokens = tokenset._replace(access_token="initial_token")
        repo = DetailedStravaActivitiesRepo(tokens, api_config)
        activity_id = 12345678987654321

        with Mocker() as m:
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            token_url = api_config.token_url

            # Sequence of events:
            # 1. First call: 401 (initial_token) -> Refresh (token_1) -> Success
            # 2. Second call: Success (using token_1)
            # 3. Third call: 401 (token_1) -> Refresh (token_2) -> Success

            m.register_uri(
                "POST",
                token_url,
                [
                    {"json": {"access_token": "token_1"}, "status_code": 200},
                    {"json": {"access_token": "token_2"}, "status_code": 200},
                ],
            )

            m.register_uri(
                "GET",
                endpoint,
                [
                    # Call 1: 401 then success
                    {"status_code": 401},
                    {"json": activity_json, "status_code": 200},
                    # Call 2: Success immediately
                    {"json": activity_json, "status_code": 200},
                    # Call 3: 401 then success
                    {"status_code": 401},
                    {"json": activity_json, "status_code": 200},
                ],
            )

            # Call 1: Should refresh to token_1
            repo.read_activity_by_id(activity_id)
            assert repo._current_access_token == "token_1"

            # Call 2: Should keep token_1
            repo.read_activity_by_id(activity_id)
            assert repo._current_access_token == "token_1"

            # Call 3: Should refresh to token_2
            # This is where the original code would fail (token_refreshed flag was stuck)
            repo.read_activity_by_id(activity_id)
            assert repo._current_access_token == "token_2"

    def test_refresh_failure_raises_error(self, repo_without_access_token, api_config):
        """Test that token refresh failure raises StravaTokenError"""
        activity_id = 12345678987654321
        with Mocker() as m:
            # Mock token refresh failure
            m.post(api_config.token_url, status_code=401)

            with pytest.raises(StravaTokenError):
                repo_without_access_token.read_activity_by_id(activity_id)
