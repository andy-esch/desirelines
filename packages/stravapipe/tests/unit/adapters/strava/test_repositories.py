"""Tests for Strava adapter repositories.

Tests the layered architecture:
- StravaTokenRepo: Token refresh via OAuth API
- StravaTokenManager: Token state management
- StravaApiClient: HTTP calls with 401 retry
- StravaActivitiesRepo: Domain model conversion
"""

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from requests_mock import Mocker

from stravapipe.adapters.strava._repositories import (
    StravaActivitiesRepo,
    StravaApiClient,
    StravaTokenManager,
    StravaTokenRepo,
    create_strava_activities_repo,
    create_strava_breaker,
)
from stravapipe.config import StravaApiConfig
from stravapipe.domain import (
    DetailedStravaActivity,
    StandardActivity,
    StravaTokenSet,
    SummaryStravaActivity,
)
from stravapipe.exceptions import (
    ActivityNotFoundError,
    StravaApiError,
    StravaRateLimitError,
    StravaTokenError,
)


@pytest.fixture
def tokenset():
    # Passes None to simulate "initial state before first refresh"; the domain
    # type declares access_token: str but the refresh flow is the subject here.
    return StravaTokenSet(
        client_id=1,
        client_secret="foo",
        refresh_token="bar",
        access_token=None,  # type: ignore[arg-type]
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
    with fixture_path.open(encoding="utf-8") as fin:
        # NOTE: id = 12345678987654321
        return json.load(fin)


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


# =============================================================================
# Shared fixture for summary activity data (list endpoint response)
# =============================================================================


@pytest.fixture
def summary_activity_json():
    """Minimal summary activity dict as returned by the Strava list endpoint."""
    return {
        "id": 77777,
        "resource_state": 2,
        "external_id": "test.fit",
        "athlete": {"id": 123, "resource_state": 1},
        "name": "Morning Run",
        "type": "Run",
        "sport_type": "Run",
        "distance": 5000.0,
        "moving_time": 1800,
        "elapsed_time": 2000,
        "total_elevation_gain": 50.0,
        "start_date": "2025-06-15T08:00:00Z",
        "start_date_local": "2025-06-15T10:00:00Z",
        "timezone": "(GMT+02:00) Europe/Berlin",
        "start_latlng": [52.52, 13.40],
        "end_latlng": [52.53, 13.41],
        "achievement_count": 0,
        "kudos_count": 2,
        "comment_count": 0,
        "athlete_count": 1,
        "photo_count": 0,
        "has_kudoed": False,
        "map": {"id": "a77777", "summary_polyline": "abc", "resource_state": 2},
        "trainer": False,
        "commute": False,
        "manual": False,
        "private": False,
        "flagged": False,
        "average_speed": 2.78,
        "max_speed": 3.5,
    }


# =============================================================================
# StravaApiClient - list_activities tests
# =============================================================================


class TestStravaApiClientListActivities:
    LIST_PATH = "/athlete/activities"

    def test_list_activities_success(self, api_client, api_config):
        """list_activities returns raw activity dicts."""
        endpoint = f"{api_config.api_base_url}{self.LIST_PATH}"
        mock_response = [{"id": 1}, {"id": 2}]

        with Mocker() as m:
            m.get(endpoint, json=mock_response)
            result = api_client.list_activities(
                before=1700000000, after=1690000000, page=1
            )

        assert len(result) == 2
        assert result[0]["id"] == 1

    def test_list_activities_401_refresh_and_retry(
        self, token_manager_with_token, api_config
    ):
        """401 on list triggers token refresh and successful retry."""
        client = StravaApiClient(token_manager_with_token, api_config)
        endpoint = f"{api_config.api_base_url}{self.LIST_PATH}"

        with Mocker() as m:
            m.get(
                endpoint,
                [
                    {"status_code": 401},
                    {"json": [{"id": 1}], "status_code": 200},
                ],
            )
            m.post(api_config.token_url, json={"access_token": "new_token"})

            result = client.list_activities(before=1700000000, after=1690000000, page=1)

        assert len(result) == 1
        assert token_manager_with_token._current_access_token == "new_token"


# =============================================================================
# StravaActivitiesRepo - read_standard_activity_by_id tests
# =============================================================================


class TestStravaActivitiesRepoStandard:
    def test_read_standard_activity_by_id(
        self, activities_repo, activity_json, api_config
    ):
        """read_standard_activity_by_id returns a StandardActivity."""
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)
            result = activities_repo.read_standard_activity_by_id(activity_id)

        assert isinstance(result, StandardActivity)
        assert result.id == activity_id
        assert result.type == "Ride"

    def test_read_standard_activity_has_computed_fields(
        self, activities_repo, activity_json, api_config
    ):
        """StandardActivity should have computed user_id, sport, and year."""
        activity_id = 12345678987654321
        with Mocker() as m:
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, json=activity_json)
            result = activities_repo.read_standard_activity_by_id(activity_id)

        assert result.user_id == str(result.athlete.id)
        assert result.sport == result.sport_type
        assert isinstance(result.year, int)


# =============================================================================
# StravaActivitiesRepo - read_activities_by_year tests
# =============================================================================


class TestStravaActivitiesRepoByYear:
    LIST_PATH = "/athlete/activities"

    def test_read_activities_by_year_single_page(
        self, activities_repo, api_config, summary_activity_json
    ):
        """Single page of results followed by empty page."""
        endpoint = f"{api_config.api_base_url}{self.LIST_PATH}"

        with Mocker() as m:
            m.get(
                endpoint,
                [
                    {"json": [summary_activity_json], "status_code": 200},
                    {"json": [], "status_code": 200},
                ],
            )
            result = activities_repo.read_activities_by_year(2025)

        assert len(result) == 1
        assert isinstance(result[0], SummaryStravaActivity)
        assert result[0].id == 77777

    def test_read_activities_by_year_multi_page(
        self, activities_repo, api_config, summary_activity_json
    ):
        """Multiple pages paginated until empty response."""
        endpoint = f"{api_config.api_base_url}{self.LIST_PATH}"
        page2_activity = {**summary_activity_json, "id": 88888}

        with Mocker() as m:
            m.get(
                endpoint,
                [
                    {"json": [summary_activity_json], "status_code": 200},
                    {"json": [page2_activity], "status_code": 200},
                    {"json": [], "status_code": 200},
                ],
            )
            result = activities_repo.read_activities_by_year(2025)

        assert len(result) == 2
        assert result[0].id == 77777
        assert result[1].id == 88888

    def test_read_activities_by_year_empty(self, activities_repo, api_config):
        """Year with no activities returns empty list."""
        endpoint = f"{api_config.api_base_url}{self.LIST_PATH}"

        with Mocker() as m:
            m.get(endpoint, json=[])
            result = activities_repo.read_activities_by_year(2020)

        assert result == []


class TestStravaCircuitBreaker:
    """Circuit-breaker behavior on the shared Strava breaker.

    ``time.sleep`` and ``random.uniform`` are patched in every test so
    the retry backoff inside ``_get_activity_with_retry`` doesn't slow
    the suite. The recovery test backdates the breaker's internal
    ``opened_at`` instead of sleeping past ``reset_timeout`` so the
    whole class runs in milliseconds.
    """

    @staticmethod
    def _build_client(token_manager_with_token, api_config, breaker) -> StravaApiClient:
        return StravaApiClient(token_manager_with_token, api_config, breaker=breaker)

    def test_trips_after_consecutive_failures(
        self, token_manager_with_token, api_config
    ):
        """5 consecutive 5xx failures open the breaker; next call fails-fast."""
        breaker = create_strava_breaker(fail_max=5, reset_timeout=60)
        client = self._build_client(token_manager_with_token, api_config, breaker)
        activity_id = 11111

        with (
            Mocker() as m,
            patch("stravapipe.retry.time.sleep"),
            patch("stravapipe.retry.random.uniform", side_effect=lambda _a, _b: 0),
        ):
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, status_code=500, text="Server Error")

            # Drive the breaker to OPEN. Each call exhausts the retry
            # loop and counts as one breaker failure.
            for _ in range(5):
                with pytest.raises(StravaApiError):
                    client.get_activity(activity_id)
            hits_after_trip = m.call_count

            # Fail-fast call: no new HTTP request.
            with pytest.raises(StravaApiError) as exc_info:
                client.get_activity(activity_id)
            assert m.call_count == hits_after_trip
            assert exc_info.value.status_code == 503
            assert "circuit breaker open" in str(exc_info.value)
            assert breaker.current_state == "open"

    def test_404_does_not_count_as_failure(self, token_manager_with_token, api_config):
        """ActivityNotFoundError is per-activity, not Strava-down."""
        breaker = create_strava_breaker(fail_max=5, reset_timeout=60)
        client = self._build_client(token_manager_with_token, api_config, breaker)
        activity_id = 22222

        with (
            Mocker() as m,
            patch("stravapipe.retry.time.sleep"),
            patch("stravapipe.retry.random.uniform", side_effect=lambda _a, _b: 0),
        ):
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            m.get(endpoint, status_code=404)

            # More attempts than the failure threshold; if 404 counted,
            # the breaker would open and the last call would fail-fast.
            for _ in range(7):
                with pytest.raises(ActivityNotFoundError):
                    client.get_activity(activity_id)

            assert breaker.current_state == "closed"

    def test_recovers_after_reset_timeout(
        self, token_manager_with_token, api_config, activity_json
    ):
        """After ``reset_timeout`` the breaker probes; a success closes it.

        Backdates ``_state_storage.opened_at`` instead of sleeping so
        the test runs in milliseconds instead of seconds. Mutating
        private state is fragile against pybreaker upgrades, but the
        alternative — `time.sleep(reset_timeout)` — would slow this
        test by orders of magnitude.
        """
        breaker = create_strava_breaker(fail_max=5, reset_timeout=60)
        client = self._build_client(token_manager_with_token, api_config, breaker)
        activity_id = activity_json["id"]

        with (
            Mocker() as m,
            patch("stravapipe.retry.time.sleep"),
            patch("stravapipe.retry.random.uniform", side_effect=lambda _a, _b: 0),
        ):
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            # `_fetch` returns the requests.Response without raising on
            # 5xx, so @retry_on_failure never sees an exception — each
            # get_activity makes exactly ONE HTTP call, not three. 5
            # breaker failures = 5 hits at 500; the 6th hit is the
            # half-open probe and returns 200.
            down = {"status_code": 500, "text": "Server Error"}
            up = {"json": activity_json, "status_code": 200}
            m.get(endpoint, [down] * 5 + [up])

            for _ in range(5):
                with pytest.raises(StravaApiError):
                    client.get_activity(activity_id)
            assert breaker.current_state == "open"

            # Fast-forward past reset_timeout without sleeping.
            breaker._state_storage.opened_at = datetime.now(UTC) - timedelta(
                seconds=120
            )

            result = client.get_activity(activity_id)
            assert result["id"] == activity_id
            assert breaker.current_state == "closed"

    def test_shared_breaker_across_token_and_api_paths(
        self, tokenset_with_access, api_config
    ):
        """Failures at the token endpoint trip the same breaker the API uses.

        Verifies the factory wires one breaker into both StravaTokenRepo
        and StravaApiClient — an outage on either endpoint short-circuits
        both paths.
        """
        breaker = create_strava_breaker(fail_max=2, reset_timeout=60)
        repo = create_strava_activities_repo(
            tokenset_with_access, api_config, breaker=breaker
        )
        activity_id = 33333

        with (
            Mocker() as m,
            patch("stravapipe.retry.time.sleep"),
            patch("stravapipe.retry.random.uniform", side_effect=lambda _a, _b: 0),
        ):
            endpoint = f"{api_config.api_base_url}/activities/{activity_id}"
            # Two API failures trip the (fail_max=2) breaker.
            m.get(endpoint, status_code=500, text="Server Error")
            for _ in range(2):
                with pytest.raises(StravaApiError):
                    repo.read_activity_by_id(activity_id)
            assert breaker.current_state == "open"

            # Token refresh through the SAME breaker also fail-fasts.
            m.post(api_config.token_url, json={"access_token": "x"})
            token_repo = StravaTokenRepo(
                tokens=tokenset_with_access, api_config=api_config, breaker=breaker
            )
            with pytest.raises(StravaApiError) as exc_info:
                token_repo.refresh()
            assert exc_info.value.status_code == 503
            assert "circuit breaker open" in str(exc_info.value)

    def test_token_endpoint_5xx_counts_as_failure(self, tokenset, api_config):
        """A 5xx on /oauth/token must count toward the breaker.

        Mirrors the Go-side `TestCircuitBreaker_TokenEndpoint5xxCountsAsFailure`:
        token-endpoint outages would silently bypass the breaker if
        ``StravaTokenError`` were raised for transient failures (the
        ``exclude`` list would swallow them). The current
        ``_do_refresh`` correctly raises ``StravaApiError`` for non-401
        failures, which counts; this test pins that contract.
        """
        breaker = create_strava_breaker(fail_max=3, reset_timeout=60)
        token_repo = StravaTokenRepo(
            tokens=tokenset, api_config=api_config, breaker=breaker
        )

        with (
            Mocker() as m,
            patch("stravapipe.retry.time.sleep"),
            patch("stravapipe.retry.random.uniform", side_effect=lambda _a, _b: 0),
        ):
            m.post(api_config.token_url, status_code=503, text="oauth down")
            for _ in range(3):
                with pytest.raises(StravaApiError) as exc_info:
                    token_repo.refresh()
                # Not the StravaTokenError subclass — that would be
                # excluded by the breaker. Must be the parent class.
                assert not isinstance(exc_info.value, StravaTokenError)

        assert breaker.current_state == "open"

    def test_breaker_excludes_per_request_signals(self):
        """The breaker's ``exclude`` list must cover per-request errors.

        Catches regressions where a new per-request exception type is
        introduced (e.g. a 410 Gone wrapper) without being added to the
        exclude list — a missed exclusion would let routine 404s push
        the breaker toward open. Mirror of the Go-side
        TestIsStravaCallSuccessful classification matrix.
        """
        breaker = create_strava_breaker()
        excluded = set(breaker.excluded_exceptions)
        # Per-request signals — Strava is fine, the request just failed.
        assert ActivityNotFoundError in excluded
        assert StravaTokenError in excluded
        assert StravaRateLimitError in excluded
        # Strava-side signals must NOT be excluded — they're the whole
        # point of the breaker.
        assert StravaApiError not in excluded
