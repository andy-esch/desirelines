"""Strava API adapters.

This module provides a layered architecture for Strava API access:

    StravaTokenRepo      - Refreshes tokens via Strava OAuth API
           ↓
    StravaTokenManager   - Manages token state + thread-safety
           ↓
    StravaApiClient      - HTTP calls, 401 retry, error translation
           ↓
    StravaActivitiesRepo - Domain model conversion

A single ``pybreaker.CircuitBreaker`` is shared across ``StravaTokenRepo``
and ``StravaApiClient`` — outbound traffic to Strava goes through one
breaker so an outage trips it once and fails-fast for every concurrent
caller until the dependency recovers. The breaker wraps the retry loop
(not vice versa) per Microsoft's combined-pattern guidance; matches the
Go side in ``packages/dispatcher/adapters/strava/client.go``.
"""

from collections.abc import Callable, Sequence
from datetime import UTC, datetime
import logging
import threading
from typing import Any

import pybreaker
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
    StravaRateLimitError,
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
# HTTP 503 is used to wrap CircuitBreakerError — the dependency is
# presumed unavailable. Callers that already treat 5xx as transient
# (Pub/Sub redelivery on the webhook path; retry loops on the backfill
# path) get the right behavior with no new error-handling branches.
HTTP_SERVICE_UNAVAILABLE = 503

# Circuit-breaker thresholds for outbound Strava-API calls. Matches the
# Go-side constants in `packages/dispatcher/adapters/strava/client.go`:
# 5 consecutive operation failures opens the breaker; 30s open-state
# cool-off before half-open probes. Per-request signals (404, 401, 429)
# are excluded so they don't push the breaker toward open — the breaker
# only counts evidence that Strava itself is down.
_BREAKER_FAILURE_THRESHOLD = 5
_BREAKER_RESET_TIMEOUT_SECONDS = 30


class _BreakerLogger(pybreaker.CircuitBreakerListener):
    """Logs Strava circuit breaker state transitions at WARNING.

    Mirrors the Go side's ``OnStateChange`` callback shape so a
    Strava outage produces equivalent diagnostic noise in both
    languages.
    """

    def state_change(
        self,
        cb: pybreaker.CircuitBreaker,
        old_state: pybreaker.CircuitBreakerState | None,
        new_state: pybreaker.CircuitBreakerState,
    ) -> None:
        logger.warning(
            "Strava circuit breaker state change",
            extra={
                "breaker": cb.name,
                "from": old_state.name if old_state is not None else None,
                "to": new_state.name,
            },
        )


def create_strava_breaker(
    *,
    fail_max: int = _BREAKER_FAILURE_THRESHOLD,
    reset_timeout: int = _BREAKER_RESET_TIMEOUT_SECONDS,
) -> pybreaker.CircuitBreaker:
    """Build the shared Strava circuit breaker.

    ``fail_max`` / ``reset_timeout`` are parameterized so tests can use
    short values; production callers should rely on the defaults. The
    ``exclude`` list captures per-request signals that should NOT count
    toward Strava-side health — 404 (per-activity), 401 (per-user
    token), 429 (per-user rate limit). Everything else (5xx, network,
    timeout) counts as a Strava failure.

    **Contract for excluded exception types:** the exclusion list is
    semantic, not structural. ``StravaTokenError`` and
    ``StravaRateLimitError`` MUST only be raised for *permanent*
    per-user signals — a 401 ``invalid_grant`` from the OAuth endpoint
    or a 429 quota exceeded. If a transient failure on the token
    endpoint (a 503 from Strava's OAuth side, a connection reset)
    were ever wrapped as ``StravaTokenError``, the breaker would
    silently miss the outage. The current call sites in
    ``StravaTokenRepo._do_refresh`` honor this: 401 → ``StravaTokenError``,
    everything else → ``StravaApiError`` (or the original ``requests``
    exception), both of which count as breaker failures.
    """
    return pybreaker.CircuitBreaker(
        fail_max=fail_max,
        reset_timeout=reset_timeout,
        exclude=[ActivityNotFoundError, StravaTokenError, StravaRateLimitError],
        listeners=[_BreakerLogger()],
        name="strava-api",
    )


def _call_through_breaker[T](
    breaker: pybreaker.CircuitBreaker,
    fn: Callable[..., T],
    /,
    *args: Any,
    _activity_id: int | None = None,
    **kwargs: Any,
) -> T:
    """Call ``fn`` through ``breaker``, translating an open breaker to a 503.

    Shared by the three outbound Strava entrypoints (``StravaTokenRepo.refresh``,
    ``StravaApiClient.get_activity`` / ``list_activities``) so the
    ``CircuitBreakerError`` → ``StravaApiError(503)`` mapping has one home.
    ``_activity_id`` is attached to the raised error on the activity path
    (``None`` is a no-op for the token/list paths).
    """
    try:
        return breaker.call(fn, *args, **kwargs)
    except pybreaker.CircuitBreakerError as exc:
        raise StravaApiError(
            f"Strava circuit breaker open: {exc}",
            status_code=HTTP_SERVICE_UNAVAILABLE,
            activity_id=_activity_id,
        ) from exc


# =============================================================================
# Token Layer
# =============================================================================


class StravaTokenRepo(ReadStravaToken):
    """Refreshes Strava access tokens via OAuth API.

    This class handles the HTTP call to Strava's token endpoint.
    It does NOT manage token state - that's StravaTokenManager's job.
    """

    def __init__(
        self,
        tokens: StravaTokenSet,
        api_config: StravaApiConfig | None = None,
        breaker: pybreaker.CircuitBreaker | None = None,
    ):
        self._tokens = tokens
        self._api_config = api_config or StravaApiConfig()
        # Default to a private breaker so a bare StravaTokenRepo (e.g. in
        # ad-hoc scripts) is still self-contained. Production code wires
        # the same breaker into StravaTokenRepo + StravaApiClient via the
        # factory so they share circuit state.
        self._breaker = breaker if breaker is not None else create_strava_breaker()

    def refresh(self) -> StravaTokenSet:
        return _call_through_breaker(self._breaker, self._do_refresh)

    def _do_refresh(self) -> StravaTokenSet:
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
            resp = requests.post(
                url=self._api_config.token_url,
                data=payload,
                timeout=self._api_config.request_timeout,
            )
            # Raise INSIDE the retried scope so @retry_on_failure sees 5xx/429
            # and can retry them (a bare returned Response never triggers a
            # retry). 401 is re-raised immediately by the decorator; 429
            # exhaustion surfaces as StravaRateLimitError.
            resp.raise_for_status()
            return resp

        try:
            resp = _refresh()
        except requests.exceptions.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code == HTTP_UNAUTHORIZED:
                raise StravaTokenError(
                    "Token refresh failed - check credentials", status_code
                ) from exc
            body = exc.response.text if exc.response is not None else str(exc)
            raise StravaApiError(f"Token refresh failed: {body}", status_code) from exc

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
        breaker: pybreaker.CircuitBreaker | None = None,
    ):
        """Initialize API client.

        Args:
            token_manager: Manager for getting/refreshing access tokens
            api_config: API configuration (URLs, timeouts, retry settings)
            breaker: Shared circuit breaker for outbound Strava calls.
                When None, a private breaker is created — production code
                should pass the same breaker as StravaTokenRepo so they
                share circuit state.
        """
        self._token_manager = token_manager
        self._api_config = api_config or StravaApiConfig()
        self._breaker = breaker if breaker is not None else create_strava_breaker()

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
            StravaApiError: For other API errors, including when the
                circuit breaker is open (status_code=503).
        """
        return _call_through_breaker(
            self._breaker,
            self._get_activity_with_retry,
            activity_id,
            _token_refresh_count=0,
            _activity_id=activity_id,
        )

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
            resp = requests.get(
                url=endpoint,
                headers=self._get_headers(),
                timeout=self._api_config.request_timeout,
            )
            # Raise INSIDE the retried scope so @retry_on_failure sees 5xx/429.
            # 4xx (404/401) is re-raised immediately; 5xx is retried then
            # re-raised; 429 exhaustion surfaces as StravaRateLimitError.
            resp.raise_for_status()
            return resp

        try:
            resp = _fetch()
        except requests.exceptions.HTTPError as exc:
            return self._handle_error_response(
                exc,
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
            StravaApiError: For other API errors, including when the
                circuit breaker is open (status_code=503).
        """
        return _call_through_breaker(
            self._breaker,
            self._list_activities_with_retry,
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
            resp = requests.get(
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
            # Raise INSIDE the retried scope so @retry_on_failure sees 5xx/429.
            resp.raise_for_status()
            return resp

        try:
            resp = _fetch()
        except requests.exceptions.HTTPError as exc:
            # Route list failures through the SAME domain-exception translation
            # as get_activity (M1) — a bare raise_for_status() here leaked
            # requests.HTTPError across the adapter boundary. activity_id=None
            # since the list endpoint isn't tied to a single activity.
            return self._handle_error_response(
                exc,
                activity_id=None,
                token_refresh_count=_token_refresh_count,
                retry_func=lambda count: self._list_activities_with_retry(
                    before=before,
                    after=after,
                    page=page,
                    per_page=per_page,
                    _token_refresh_count=count,
                ),
            )

        data: list[dict[str, Any]] = resp.json()
        return data

    def _handle_error_response[T](
        self,
        exc: requests.exceptions.HTTPError,
        *,
        token_refresh_count: int,
        retry_func: Callable[[int], T],
        activity_id: int | None = None,
    ) -> T:
        """Translate a caught ``HTTPError`` into a domain exception.

        Because each ``_fetch`` now calls ``raise_for_status()`` inside the
        retried scope, a 4xx/5xx no longer returns a ``Response`` to inspect —
        it raises. This handler keys off the caught exception's status code
        instead of ``resp.ok``. Shared by ``get_activity`` and
        ``list_activities``; ``activity_id`` is ``None`` on the list path.

        Mapping (preserved exactly):
        - 401 → refresh token and retry once via ``retry_func``; a second 401
          (``token_refresh_count`` exhausted) → ``StravaTokenError``.
        - 404 → ``ActivityNotFoundError`` (single-activity path only; a 404
          has no meaning for the list endpoint, so it falls through to
          ``StravaApiError`` when ``activity_id is None``).
        - anything else (5xx that survived retry, other 4xx) → ``StravaApiError``.

        A 429 never reaches here: the retry decorator surfaces it as
        ``StravaRateLimitError`` (not an ``HTTPError``), so it propagates past
        this handler and keeps the circuit-breaker ``exclude`` contract intact.
        """
        status_code = exc.response.status_code if exc.response is not None else None

        # Handle 401: refresh token and retry (once).
        if (
            status_code == HTTP_UNAUTHORIZED
            and token_refresh_count < self._MAX_TOKEN_REFRESH_RETRIES
        ):
            logger.warning(
                "Got 401 from Strava, refreshing token and retrying (attempt %d/%d)...",
                token_refresh_count + 1,
                self._MAX_TOKEN_REFRESH_RETRIES,
                extra={
                    "operation": "strava_api_call",
                    "activity_id": activity_id,
                    "action": "token_refresh_retry",
                    "token_refresh_attempt": token_refresh_count + 1,
                    "max_token_refresh_retries": self._MAX_TOKEN_REFRESH_RETRIES,
                },
            )
            self._token_manager.refresh()
            return retry_func(token_refresh_count + 1)

        # Log and raise appropriate exception.
        logger.error(
            "Strava API call failed (status=%s, activity_id=%s)",
            status_code,
            activity_id,
            extra={
                "operation": "strava_api_call",
                "activity_id": activity_id,
                "status_code": status_code,
                "error_type": "api_error",
            },
        )

        if status_code == HTTP_NOT_FOUND and activity_id is not None:
            raise ActivityNotFoundError(activity_id) from exc
        if status_code == HTTP_UNAUTHORIZED:
            raise StravaTokenError(
                f"Access token expired after {token_refresh_count} refresh attempts",
                status_code,
                activity_id,
            ) from exc
        body = exc.response.text if exc.response is not None else str(exc)
        raise StravaApiError(
            f"Strava API call failed ({status_code}): {body}",
            status_code,
            activity_id,
        ) from exc


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
    breaker: pybreaker.CircuitBreaker | None = None,
) -> StravaActivitiesRepo:
    """Create a fully-wired StravaActivitiesRepo.

    This factory hides the internal wiring of token management and API client
    from callers. It's the recommended way to create a repository.

    Args:
        tokens: Strava OAuth tokens (client_id, client_secret, refresh_token,
                and optionally access_token)
        api_config: Optional API configuration (URLs, timeouts, retry settings)
        breaker: Optional circuit breaker. Defaults to a fresh shared
            instance — production code generally wants the default since
            each composition root creates a long-lived repo and the
            breaker state should live for the process lifetime. Tests
            can pass a breaker with a short ``reset_timeout``.

    Returns:
        Configured StravaActivitiesRepo ready for use
    """
    config = api_config or StravaApiConfig()
    # One breaker shared across the token-refresh and API-call paths
    # so an outage trips it once for the entire Strava dependency.
    shared_breaker = breaker if breaker is not None else create_strava_breaker()

    # Build the dependency chain
    token_repo = StravaTokenRepo(tokens, config, breaker=shared_breaker)
    token_manager = StravaTokenManager(token_repo, tokens.access_token)
    api_client = StravaApiClient(token_manager, config, breaker=shared_breaker)

    return StravaActivitiesRepo(api_client)
