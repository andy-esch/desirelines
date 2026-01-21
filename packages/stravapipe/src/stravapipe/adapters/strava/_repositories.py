"""Strava read repositories"""

import logging
import threading
from collections.abc import Sequence
from datetime import UTC, datetime
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


class StravaTokenRepo(ReadStravaToken):
    """Fetch new access token"""

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
        def _refresh():
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
            if resp.status_code == 401:
                raise StravaTokenError(
                    "Token refresh failed - check credentials", resp.status_code
                )
            else:
                raise StravaApiError(
                    f"Token refresh failed: {resp.text}", resp.status_code
                )

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


class DetailedStravaActivitiesRepo(ReadDetailedActivities, ReadStandardActivities):
    """Repository for fetching Strava Activities.

    Implements both ReadDetailedActivities (for BQ inserter) and
    ReadStandardActivities (for PostgreSQL writer).

    Token Management:
        - If tokens.access_token is None, automatically refreshes on first API call
        - On 401 response, refreshes token and retries once
        - Callers don't need to manually refresh tokens before using this repo
    """

    def __init__(
        self, tokens: StravaTokenSet, api_config: StravaApiConfig | None = None
    ):
        self._initial_tokens = tokens
        self._api_config = api_config or StravaApiConfig()
        self._token_repo = StravaTokenRepo(tokens, self._api_config)
        # Lazy-initialized on first API call if None
        self._current_access_token: str | None = tokens.access_token
        # Lock to prevent concurrent token refresh operations
        self._token_lock = threading.Lock()

    def _ensure_fresh_token(self) -> str:
        """Ensure we have a valid access token, refreshing if needed.

        Thread-safe: uses lock to prevent concurrent refresh operations.

        Returns:
            Valid access token string
        """
        with self._token_lock:
            if self._current_access_token is None:
                logger.info("No access token provided, refreshing...")
                refreshed = self._token_repo.refresh()
                self._current_access_token = refreshed.access_token
            return self._current_access_token

    def _refresh_token(self) -> str:
        """Force refresh the access token.

        Thread-safe: uses lock to prevent concurrent refresh operations.

        Returns:
            New access token string
        """
        with self._token_lock:
            logger.info("Refreshing Strava access token...")
            refreshed = self._token_repo.refresh()
            self._current_access_token = refreshed.access_token
            return self._current_access_token

    def _get_headers(self) -> dict[str, str]:
        """Get request headers with current access token."""
        token = self._ensure_fresh_token()
        return {"Authorization": f"Bearer {token}"}

    _MAX_TOKEN_REFRESH_RETRIES: int = 1

    def _read_raw_activity_by_id(
        self, activity_id: int, *, _token_refresh_count: int = 0
    ) -> dict[str, Any]:
        @retry_on_failure(
            max_attempts=self._api_config.activity_retry_attempts,
            backoff_seconds=self._api_config.activity_retry_backoff,
        )
        def _fetch():
            activity_endpoint = (
                f"{self._api_config.api_base_url}/activities/{activity_id}"
            )
            return requests.get(
                url=activity_endpoint,
                headers=self._get_headers(),
                timeout=self._api_config.request_timeout,
            )

        resp = _fetch()
        if not resp.ok:
            # Handle 401: refresh token and retry up to max retries
            if (
                resp.status_code == 401
                and _token_refresh_count < self._MAX_TOKEN_REFRESH_RETRIES
            ):
                logger.warning(
                    "Got 401 for activity %s, refreshing token and retrying "
                    "(attempt %d/%d)...",
                    activity_id,
                    _token_refresh_count + 1,
                    self._MAX_TOKEN_REFRESH_RETRIES,
                    extra={
                        "operation": "fetch_activity",
                        "activity_id": activity_id,
                        "action": "token_refresh_retry",
                        "token_refresh_attempt": _token_refresh_count + 1,
                        "max_token_refresh_retries": self._MAX_TOKEN_REFRESH_RETRIES,
                    },
                )
                self._refresh_token()
                return self._read_raw_activity_by_id(
                    activity_id, _token_refresh_count=_token_refresh_count + 1
                )

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
            if resp.status_code == 404:
                raise ActivityNotFoundError(activity_id)
            elif resp.status_code == 401:
                raise StravaTokenError(
                    f"Access token expired after {_token_refresh_count} refresh attempts",
                    resp.status_code,
                    activity_id,
                )
            else:
                raise StravaApiError(
                    f"Failed to fetch activity {activity_id}: {resp.text}",
                    resp.status_code,
                    activity_id,
                )

        logger.info(
            "Successfully fetched activity from Strava",
            extra={
                "operation": "fetch_activity",
                "activity_id": activity_id,
                "status_code": resp.status_code,
            },
        )
        return resp.json()

    def read_activity_by_id(self, activity_id: int) -> DetailedStravaActivity:
        """Fetch a detailed Activity from Strava (all ~60 fields).

        Used by BQ inserter for full activity storage.
        https://developers.strava.com/docs/reference/#api-models-DetailedActivity
        """
        raw = self._read_raw_activity_by_id(activity_id)
        return DetailedStravaActivity(**raw)

    def read_standard_activity_by_id(self, activity_id: int) -> StandardActivity:
        """Fetch a standard Activity from Strava (only PostgreSQL-relevant fields).

        Used by PostgreSQL writer. Validates only the fields we store.
        """
        raw = self._read_raw_activity_by_id(activity_id)
        return StandardActivity.model_validate(raw)

    def _read_activities(
        self,
        *,
        before: int,
        after: int,
        page: int,
        per_page: int = 100,
        _token_refresh_count: int = 0,
    ) -> list[SummaryStravaActivity]:
        """Fetch activities from list endpoint (returns SummaryActivity objects)

        The /athlete/activities endpoint returns SummaryActivity, not DetailedActivity.
        This is missing some fields like segment_efforts, splits, laps, photos, etc.
        but has all the core activity data we need for most use cases.
        """
        activities_endpoint = f"{self._api_config.api_base_url}/athlete/activities"
        resp = requests.get(
            url=activities_endpoint,
            headers=self._get_headers(),
            params={
                "before": before,
                "after": after,
                "page": page,
                "per_page": per_page,
            },
            timeout=self._api_config.request_timeout,
        )
        if not resp.ok:
            # Handle 401: refresh token and retry up to max retries
            if (
                resp.status_code == 401
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
                self._refresh_token()
                return self._read_activities(
                    before=before,
                    after=after,
                    page=page,
                    per_page=per_page,
                    _token_refresh_count=_token_refresh_count + 1,
                )
            resp.raise_for_status()
        activities = [SummaryStravaActivity(**activity) for activity in resp.json()]
        return activities

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
        activities = []
        while True:
            resp = self._read_activities(
                after=date_start,
                before=date_end,
                page=page,
            )
            if len(resp) == 0:
                break

            activities.extend(resp)
            logger.info("Page %s successfully fetched", page)
            page += 1

        return activities
