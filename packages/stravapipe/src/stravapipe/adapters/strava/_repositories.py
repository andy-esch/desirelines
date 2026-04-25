"""Strava API adapters.

This module provides a layered architecture for Strava API access:

    StravaTokenRepo      - Refreshes tokens via Strava OAuth API
           ↓
    StravaTokenManager   - Manages token state + thread-safety
           ↓
    StravaApiClient      - HTTP calls, 401 retry, error translation
           ↓
    StravaActivitiesRepo - Domain model conversion
"""

from collections.abc import Callable, Sequence
from datetime import UTC, datetime
import logging
import threading
from typing import Any

import requests

from stravapipe.config.common import StravaApiConfig
from stravapipe.domain import (
    DetailedStravaActivity,
    StandardActivity,
    StravaTokenSet,
    SummaryStravaActivity,
)
from stravapipe.exceptions import (
    ActivityNotFoundError,
    StravaApiError,
    StravaTokenError,
)
from stravapipe.ports.out.read import (
    ReadDetailedActivities,
    ReadStandardActivities,
    ReadStravaToken,
)
from stravapipe.retry import retry_on_failure

logger = logging.getLogger(__name__)

# HTTP status code constants used by Strava API error handling.
HTTP_UNAUTHORIZED = 401
HTTP_NOT_FOUND = 404


# =============================================================================
# Token Layer
# =============================================================================


class StravaTokenRepo(ReadStravaToken):
    """Refreshes Strava access tokens via OAuth API.

    This class handles the HTTP call to Strava's token endpoint.
    It does NOT manage token state - that's StravaTokenManager's job.
    """

    def __init__(
        self, tokens: StravaTokenSet, api_config: StravaApiConfig | None = None
    ):
        self._tokens = tokens
        self._api_config = api_config or StravaApiConfig()

    def refresh(self) -> StravaTokenSet:
        @retry_on_failure(
            max_attempts=self._api_config.token_retry_attempts,
            backoff_seconds=self._api_config.token_retry_backoff,
        )
        def _refresh() -> requests.Response:
            payload = {
                "client_id": self._tokens.client_id,
                "client_secret": self._tokens.client_secret,
                "refresh_token": self._tokens.refresh_token,
                "grant_type": "refresh_token",
            }
            return requests.post(
                url=self._api_config.token_url,
                data=payload,
                timeout=self._api_config.request_timeout,
            )

        resp = _refresh()

        if not resp.ok:
            if resp.status_code == HTTP_UNAUTHORIZED:
                raise StravaTokenError(
                    "Token refresh failed - check credentials", resp.status_code
                )
            raise StravaApiError(f"Token refresh failed: {resp.text}", resp.status_code)

        access_token = resp.json()["access_token"]
        logger.info(
            "Tokens successfully updated",
            extra={
                "operation": "token_refresh",
                "status_code": resp.status_code,
                "client_id": self._tokens.client_id,
            },
        )
        return StravaTokenSet(
            client_id=self._tokens.client_id,
            client_secret=self._tokens.client_secret,
            access_token=access_token,
            refresh_token=self._tokens.refresh_token,
        )


class StravaTokenManager:
    """Manages Strava access token state with thread-safe refresh.

    Responsibilities:
    - Stores current access token
    - Thread-safe lazy initialization (refresh on first use if None)
    - Thread-safe forced refresh (on 401)

    This class does NOT make HTTP calls - it delegates to StravaTokenRepo.
    """

    def __init__(
        self,
        token_repo: StravaTokenRepo,
        initial_access_token: str | None = None,
    ):
        """Initialize token manager.

        Args:
            token_repo: Repository for refreshing tokens via API
            initial_access_token: Pre-existing access token, or None to refresh on first use
        """
        self._token_repo = token_repo
        self._current_access_token = initial_access_token
        self._lock = threading.Lock()

    def get_token(self) -> str:
        """Get a valid access token, refreshing if needed.

        Thread-safe: uses lock to prevent concurrent refresh operations.

        Returns:
            Valid access token string
        """
        with self._lock:
            if self._current_access_token is None:
                logger.info("No access token provided, refreshing...")
                refreshed = self._token_repo.refresh()
                self._current_access_token = refreshed.access_token
            return self._current_access_token

    def refresh(self) -> str:
        """Force refresh the access token.

        Thread-safe: uses lock to prevent concurrent refresh operations.

        Returns:
            New access token string
        """
        with self._lock:
            logger.info("Refreshing Strava access token...")
            refreshed = self._token_repo.refresh()
            self._current_access_token = refreshed.access_token
            return self._current_access_token


# =============================================================================
# API Client Layer
# =============================================================================


class StravaApiClient:
    """HTTP client for Strava API with automatic token refresh on 401.

    Responsibilities:
    - Makes authenticated HTTP requests to Strava API
    - Handles 401 by refreshing token and retrying (once)
    - Translates HTTP errors to domain exceptions
    - Applies retry logic for transient failures

    This class does NOT convert responses to domain models - that's the repo's job.
    """

    _MAX_TOKEN_REFRESH_RETRIES: int = 1

    def __init__(
        self,
        token_manager: StravaTokenManager,
        api_config: StravaApiConfig | None = None,
    ):
        """Initialize API client.

        Args:
            token_manager: Manager for getting/refreshing access tokens
            api_config: API configuration (URLs, timeouts, retry settings)
        """
        self._token_manager = token_manager
        self._api_config = api_config or StravaApiConfig()

    def _get_headers(self) -> dict[str, str]:
        """Get request headers with current access token."""
        token = self._token_manager.get_token()
        return {"Authorization": f"Bearer {token}"}

    def get_activity(self, activity_id: int) -> dict[str, Any]:
        """Fetch a single activity by ID.

        Args:
            activity_id: Strava activity ID

        Returns:
            Raw activity data as dict

        Raises:
            ActivityNotFoundError: If activity doesn't exist (404)
            StravaTokenError: If authentication fails after retry (401)
            StravaApiError: For other API errors
        """
        return self._get_activity_with_retry(activity_id, _token_refresh_count=0)

    def _get_activity_with_retry(
        self, activity_id: int, *, _token_refresh_count: int
    ) -> dict[str, Any]:
        """Internal: fetch activity with 401 retry logic."""

        @retry_on_failure(
            max_attempts=self._api_config.activity_retry_attempts,
            backoff_seconds=self._api_config.activity_retry_backoff,
        )
        def _fetch() -> requests.Response:
            endpoint = f"{self._api_config.api_base_url}/activities/{activity_id}"
            return requests.get(
                url=endpoint,
                headers=self._get_headers(),
                timeout=self._api_config.request_timeout,
            )

        resp = _fetch()

        if not resp.ok:
            return self._handle_error_response(
                resp,
                activity_id=activity_id,
                token_refresh_count=_token_refresh_count,
                retry_func=lambda count: self._get_activity_with_retry(
                    activity_id, _token_refresh_count=count
                ),
            )

        logger.info(
            "Successfully fetched activity from Strava",
            extra={
                "operation": "fetch_activity",
                "activity_id": activity_id,
                "status_code": resp.status_code,
            },
        )
        data: dict[str, Any] = resp.json()
        return data

    def list_activities(
        self, *, before: int, after: int, page: int, per_page: int = 100
    ) -> list[dict[str, Any]]:
        """Fetch a page of activities.

        Args:
            before: Unix timestamp - return activities before this time
            after: Unix timestamp - return activities after this time
            page: Page number (1-indexed)
            per_page: Results per page (max 200)

        Returns:
            List of raw activity data dicts

        Raises:
            StravaTokenError: If authentication fails after retry
            StravaApiError: For other API errors
        """
        return self._list_activities_with_retry(
            before=before,
            after=after,
            page=page,
            per_page=per_page,
            _token_refresh_count=0,
        )

    def _list_activities_with_retry(
        self,
        *,
        before: int,
        after: int,
        page: int,
        per_page: int,
        _token_refresh_count: int,
    ) -> list[dict[str, Any]]:
        """Internal: list activities with 401 retry logic."""

        @retry_on_failure(
            max_attempts=self._api_config.activity_retry_attempts,
            backoff_seconds=self._api_config.activity_retry_backoff,
        )
        def _fetch() -> requests.Response:
            endpoint = f"{self._api_config.api_base_url}/athlete/activities"
            return requests.get(
                url=endpoint,
                headers=self._get_headers(),
                params={
                    "before": before,
                    "after": after,
                    "page": page,
                    "per_page": per_page,
                },
                timeout=self._api_config.request_timeout,
            )

        resp = _fetch()

        if not resp.ok:
            # Handle 401 with retry
            if (
                resp.status_code == HTTP_UNAUTHORIZED
                and _token_refresh_count < self._MAX_TOKEN_REFRESH_RETRIES
            ):
                logger.warning(
                    "Got 401 listing activities, refreshing token and retrying "
                    "(attempt %d/%d)...",
                    _token_refresh_count + 1,
                    self._MAX_TOKEN_REFRESH_RETRIES,
                    extra={
                        "operation": "list_activities",
                        "page": page,
                        "action": "token_refresh_retry",
                        "token_refresh_attempt": _token_refresh_count + 1,
                        "max_token_refresh_retries": self._MAX_TOKEN_REFRESH_RETRIES,
                    },
                )
                self._token_manager.refresh()
                return self._list_activities_with_retry(
                    before=before,
                    after=after,
                    page=page,
                    per_page=per_page,
                    _token_refresh_count=_token_refresh_count + 1,
                )
            resp.raise_for_status()

        data: list[dict[str, Any]] = resp.json()
        return data

    def _handle_error_response(
        self,
        resp: requests.Response,
        *,
        activity_id: int,
        token_refresh_count: int,
        retry_func: Callable[[int], dict[str, Any]],
    ) -> dict[str, Any]:
        """Handle error responses with 401 retry and exception translation."""
        # Handle 401: refresh token and retry
        if (
            resp.status_code == HTTP_UNAUTHORIZED
            and token_refresh_count < self._MAX_TOKEN_REFRESH_RETRIES
        ):
            logger.warning(
                "Got 401 for activity %s, refreshing token and retrying "
                "(attempt %d/%d)...",
                activity_id,
                token_refresh_count + 1,
                self._MAX_TOKEN_REFRESH_RETRIES,
                extra={
                    "operation": "fetch_activity",
                    "activity_id": activity_id,
                    "action": "token_refresh_retry",
                    "token_refresh_attempt": token_refresh_count + 1,
                    "max_token_refresh_retries": self._MAX_TOKEN_REFRESH_RETRIES,
                },
            )
            self._token_manager.refresh()
            return retry_func(token_refresh_count + 1)

        # Log and raise appropriate exception
        logger.error(
            "Failed to fetch activity %s: %s",
            activity_id,
            resp.status_code,
            extra={
                "operation": "fetch_activity",
                "activity_id": activity_id,
                "status_code": resp.status_code,
                "error_type": "api_error",
            },
        )

        if resp.status_code == HTTP_NOT_FOUND:
            raise ActivityNotFoundError(activity_id)
        if resp.status_code == HTTP_UNAUTHORIZED:
            raise StravaTokenError(
                f"Access token expired after {token_refresh_count} refresh attempts",
                resp.status_code,
                activity_id,
            )
        raise StravaApiError(
            f"Failed to fetch activity {activity_id}: {resp.text}",
            resp.status_code,
            activity_id,
        )


# =============================================================================
# Repository Layer
# =============================================================================


class StravaActivitiesRepo(ReadDetailedActivities, ReadStandardActivities):
    """Repository for fetching Strava activities and converting to domain models.

    Responsibilities:
    - Fetches activities via StravaApiClient
    - Converts raw API responses to domain models
    - Handles pagination for bulk fetches

    This class does NOT handle HTTP, authentication, or error translation -
    that's delegated to StravaApiClient.
    """

    def __init__(self, api_client: StravaApiClient):
        """Initialize repository.

        Args:
            api_client: Client for making Strava API calls
        """
        self._client = api_client

    def read_activity_by_id(self, activity_id: int) -> DetailedStravaActivity:
        """Fetch a detailed Activity from Strava (all ~60 fields).

        Used by BQ inserter for full activity storage.
        https://developers.strava.com/docs/reference/#api-models-DetailedActivity
        """
        raw = self._client.get_activity(activity_id)
        return DetailedStravaActivity(**raw)

    def read_standard_activity_by_id(self, activity_id: int) -> StandardActivity:
        """Fetch a standard Activity from Strava (only PostgreSQL-relevant fields).

        Used by PostgreSQL writer. Validates only the fields we store.
        """
        raw = self._client.get_activity(activity_id)
        return StandardActivity.model_validate(raw)

    def read_activities_by_year(
        self, year: int
    ) -> Sequence[DetailedStravaActivity | SummaryStravaActivity]:
        """Read all Strava activities in a year using the list endpoint.

        Returns SummaryActivity objects (not DetailedActivity). This is much more
        efficient for bulk operations: 1 API call per 100 activities vs 1 per activity.

        Missing fields (will be NULL in BigQuery):
        - segment_efforts, splits_metric, splits_standard, laps, best_efforts
        - hide_from_home, photos, embed_token
        - stats_visibility, display_hide_heartrate_option, available_zones

        Has all the important fields:
        - Core: id, name, type, distance, moving_time, dates, location
        - Performance: speeds, cadence, watts, heartrate, elevation
        - Social: kudos_count, comment_count, photo_count
        - Map: summary_polyline (not full polyline)
        """
        date_start = int(datetime(year, 1, 1, tzinfo=UTC).timestamp())
        date_end = int(datetime(year + 1, 1, 1, tzinfo=UTC).timestamp())

        page = 1
        activities: list[SummaryStravaActivity] = []
        while True:
            raw_activities = self._client.list_activities(
                after=date_start,
                before=date_end,
                page=page,
            )
            if len(raw_activities) == 0:
                break

            activities.extend(
                SummaryStravaActivity(**activity) for activity in raw_activities
            )
            logger.info("Page %s successfully fetched", page)
            page += 1

        return activities


# =============================================================================
# Factory Functions
# =============================================================================


def create_strava_activities_repo(
    tokens: StravaTokenSet,
    api_config: StravaApiConfig | None = None,
) -> StravaActivitiesRepo:
    """Create a fully-wired StravaActivitiesRepo.

    This factory hides the internal wiring of token management and API client
    from callers. It's the recommended way to create a repository.

    Args:
        tokens: Strava OAuth tokens (client_id, client_secret, refresh_token,
                and optionally access_token)
        api_config: Optional API configuration (URLs, timeouts, retry settings)

    Returns:
        Configured StravaActivitiesRepo ready for use
    """
    config = api_config or StravaApiConfig()

    # Build the dependency chain
    token_repo = StravaTokenRepo(tokens, config)
    token_manager = StravaTokenManager(token_repo, tokens.access_token)
    api_client = StravaApiClient(token_manager, config)

    return StravaActivitiesRepo(api_client)
