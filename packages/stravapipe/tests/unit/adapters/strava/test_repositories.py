"""Tests for Strava adapter repositories.

Tests the layered architecture:
- StravaTokenRepo: Token refresh via OAuth API
- StravaTokenManager: Token state management
- StravaApiClient: HTTP calls with 401 retry
- StravaActivitiesRepo: Domain model conversion
"""

import json
from pathlib import Path

import pytest
from requests_mock import Mocker

from stravapipe.adapters.strava._repositories import (
    StravaActivitiesRepo,
    StravaApiClient,
    StravaTokenManager,
    StravaTokenRepo,
    create_strava_activities_repo,
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
def tokenset_with_access():
    return StravaTokenSet(
        client_id=1, client_secret="foo", refresh_token="bar", access_token="baz"
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
def token_manager_with_token(tokenset_with_access, api_config):
    """Token manager with an existing access token."""
    token_repo = StravaTokenRepo(tokens=tokenset_with_access, api_config=api_config)
    return StravaTokenManager(token_repo, tokenset_with_access.access_token)


@pytest.fixture
def token_manager_without_token(tokenset, api_config):
    """Token manager without an access token (requires refresh)."""
    token_repo = StravaTokenRepo(tokens=tokenset, api_config=api_config)
    return StravaTokenManager(token_repo, None)


@pytest.fixture
def api_client(token_manager_with_token, api_config):
    return StravaApiClient(token_manager_with_token, api_config)


@pytest.fixture
def activities_repo(api_client):
    return StravaActivitiesRepo(api_client)


class TestStravaTokenRepo:
    def test_refresh(self, token_repo, api_config):
        with Mocker() as m:
            m.post(api_config.token_url, json={"access_token": "baz"})
            expected = token_repo.refresh()
            assert expected.access_token == "baz"

    def test_failed_request(self, token_repo, api_config):
        with Mocker() as m:
            m.post(api_config.token_url, status_code=401)

            with pytest.raises(StravaTokenError):
                token_repo.refresh()

    def test_failed_request_non_401(self, token_repo, api_config):
        with Mocker() as m:
            m.post(api_config.token_url, status_code=500, text="Server Error")

            with pytest.raises(StravaApiError):
                token_repo.refresh()


class TestStravaTokenManager:
    def test_get_token_returns_existing_token(self, token_manager_with_token):
        """If access token exists, get_token returns it without refreshing."""
        token = token_manager_with_token.get_token()
        assert token == "baz"

    def test_get_token_refreshes_when_none(
        self, token_manager_without_token, api_config
    ):
        """If no access token, get_token refreshes automatically."""
        with Mocker() as m:
            m.post(api_config.token_url, json={"access_token": "fresh_token"})
            token = token_manager_without_token.get_token()
            assert token == "fresh_token"

    def test_refresh_updates_token(self, token_manager_with_token, api_config):
        """Force refresh updates the stored token."""
        with Mocker() as m:
            m.post(api_config.token_url, json={"access_token": "new_token"})
            new_token = token_manager_with_token.refresh()
            assert new_token == "new_token"
            # Subsequent get_token returns the new token
            assert token_manager_with_token.get_token() == "new_token"


class TestStravaApiClient:
    def test_get_activity_success(self, api_client, activity_json, api_config):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)
            result = api_client.get_activity(activity_id)

        assert result["id"] == activity_id

    def test_get_activity_not_found(self, api_client, api_config):
        activity_id = -10
        with Mocker() as m:
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, status_code=404)
            with pytest.raises(ActivityNotFoundError):
                api_client.get_activity(activity_id)

    def test_get_activity_api_error(self, api_client, api_config):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, status_code=500, text="Server Error")
            with pytest.raises(StravaApiError):
                api_client.get_activity(activity_id)

    def test_get_activity_401_refresh_and_retry_succeeds(
        self, token_manager_with_token, api_config, activity_json
    ):
        """Test that 401 triggers token refresh and successful retry."""
        api_client = StravaApiClient(token_manager_with_token, api_config)
        activity_id = 12345678987654321

        with Mocker() as m:
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            # First call returns 401, then retry succeeds
            m.get(
                endpoint,
                [
                    {"status_code": 401},
                    {"json": activity_json, "status_code": 200},
                ],
            )
            m.post(api_config.token_url, json={"access_token": "new_token"})

            result = api_client.get_activity(activity_id)

            assert result["id"] == activity_id
            # Verify token was refreshed
            assert token_manager_with_token._current_access_token == "new_token"

    def test_get_activity_401_after_refresh_raises_error(
        self, token_manager_with_token, api_config
    ):
        """Test that 401 after token refresh raises StravaTokenError."""
        api_client = StravaApiClient(token_manager_with_token, api_config)
        activity_id = 12345678987654321

        with Mocker() as m:
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            # Both calls return 401
            m.get(endpoint, status_code=401)
            m.post(api_config.token_url, json={"access_token": "new_token"})

            with pytest.raises(StravaTokenError):
                api_client.get_activity(activity_id)


class TestStravaActivitiesRepo:
    def test_read_activity_by_id(self, activities_repo, activity_json, api_config):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)
            resp = activities_repo.read_activity_by_id(activity_id)

        assert resp.id == activity_id

    def test_read_activity_by_id_returns_detailed_activity(
        self, activities_repo, activity_json, api_config
    ):
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)
            resp = activities_repo.read_activity_by_id(activity_id)

        assert isinstance(resp, DetailedStravaActivity)


class TestStravaActivitiesRepoIntegration:
    """Integration tests using the full factory-created repo."""

    def test_auto_refresh_on_first_call(self, tokenset, activity_json, api_config):
        """Test that missing access_token triggers automatic refresh."""
        repo = create_strava_activities_repo(tokenset, api_config)
        activity_id = 12345678987654321

        with Mocker() as m:
            # Mock token refresh
            m.post(api_config.token_url, json={"access_token": "fresh_token"})
            # Mock activity endpoint
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)

            resp = repo.read_activity_by_id(activity_id)

            assert resp.id == activity_id
            # Verify token refresh was called (1 refresh + 1 activity)
            assert m.call_count == 2

    def test_token_reused_across_calls(self, tokenset, activity_json, api_config):
        """Test that refreshed token is reused for subsequent calls."""
        repo = create_strava_activities_repo(tokenset, api_config)
        activity_id = 12345678987654321

        with Mocker() as m:
            # Mock token refresh (should only be called once)
            m.post(api_config.token_url, json={"access_token": "fresh_token"})
            # Mock activity endpoint
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)

            # First call
            repo.read_activity_by_id(activity_id)
            # Second call - should reuse token
            repo.read_activity_by_id(activity_id)

            # Token refresh called once, activity endpoint called twice
            assert m.call_count == 3  # 1 refresh + 2 activities

    def test_multiple_refreshes_over_time(
        self, tokenset_with_access, activity_json, api_config
    ):
        """Test that the repo can handle multiple 401s over time."""
        # Initialize WITH a token so we don't trigger the "first call auto-refresh"
        repo = create_strava_activities_repo(tokenset_with_access, api_config)
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

            # Call 2: Should keep token_1
            repo.read_activity_by_id(activity_id)

            # Call 3: Should refresh to token_2
            repo.read_activity_by_id(activity_id)

    def test_refresh_failure_raises_error(self, tokenset, api_config):
        """Test that token refresh failure raises StravaTokenError."""
        repo = create_strava_activities_repo(tokenset, api_config)
        activity_id = 12345678987654321

        with Mocker() as m:
            # Mock token refresh failure
            m.post(api_config.token_url, status_code=401)

            with pytest.raises(StravaTokenError):
                repo.read_activity_by_id(activity_id)
