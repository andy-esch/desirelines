"""Strava read repositories"""

from datetime import UTC, datetime
import logging
from typing import Any, NamedTuple

import requests

from stravapipe.domain import (
    DetailedStravaActivity,
    MinimalStravaActivity,
    StravaTokenSet,
)
from stravapipe.exceptions import (
    ActivityNotFoundError,
    StravaApiError,
    StravaTokenError,
)
from stravapipe.ports.out.read import (
    ReadDetailedActivities,
    ReadMinimalActivities,
    ReadStravaToken,
)
from stravapipe.retry import retry_on_failure

logger = logging.getLogger(__name__)


class StravaApiConfig(NamedTuple):
    """Strava API configuration"""

    token_url: str = "https://www.strava.com/oauth/token"
    api_base_url: str = "https://www.strava.com/api/v3"
    request_timeout: int = 10
    token_retry_attempts: int = 2
    token_retry_backoff: float = 0.5
    activity_retry_attempts: int = 3
    activity_retry_backoff: float = 1.0


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


class DetailedStravaActivitiesRepo(ReadDetailedActivities):
    """Repository for fetching detailed Strava Activities (for BQ inserter)"""

    def __init__(
        self, tokens: StravaTokenSet, api_config: StravaApiConfig | None = None
    ):
        self._tokens = tokens
        self._api_config = api_config or StravaApiConfig()
        self._headers = {"Authorization": f"Bearer {self._tokens.access_token}"}

    def _read_raw_activity_by_id(self, activity_id: int) -> dict[str, Any]:
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
                headers=self._headers,
                timeout=self._api_config.request_timeout,
            )

        resp = _fetch()
        if not resp.ok:
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
                    "Access token expired", resp.status_code, activity_id
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
        """Fetch an Activity from Strava. An activity is roughly Strava's
        DetailedActivity model:
          https://developers.strava.com/docs/reference/#api-models-DetailedActivity
        """
        resp = self._read_raw_activity_by_id(activity_id)
        activity = DetailedStravaActivity(**resp)
        return activity

    def _read_activities(
        self, *, before: int, after: int, page: int, per_page: int = 100
    ) -> list[DetailedStravaActivity]:
        """Gather activities according to params"""
        activities_endpoint = f"{self._api_config.api_base_url}/activities"
        resp = requests.get(
            url=activities_endpoint,
            headers=self._headers,
            params={
                "before": before,
                "after": after,
                "page": page,
                "per_page": per_page,
            },
            timeout=self._api_config.request_timeout,
        )
        if not resp.ok:
            resp.raise_for_status()
        activities = [DetailedStravaActivity(**activity) for activity in resp.json()]
        return activities

    def read_activities_by_year(self, year: int) -> list[DetailedStravaActivity]:
        """Read all Strava activities in a year"""
        date_start = int(datetime(year, 1, 1, tzinfo=UTC).strftime("%s"))
        date_end = int(datetime(year + 1, 1, 1, tzinfo=UTC).strftime("%s"))

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


class MinimalStravaActivitiesRepo(ReadMinimalActivities):
    """Repository for fetching minimal Strava Activities (for aggregator)

    Returns only the minimal fields needed for aggregation calculations.
    Faster validation and lower memory usage than DetailedStravaActivitiesRepo.
    """

    def __init__(
        self, tokens: StravaTokenSet, api_config: StravaApiConfig | None = None
    ):
        self._tokens = tokens
        self._api_config = api_config or StravaApiConfig()
        self._headers = {"Authorization": f"Bearer {self._tokens.access_token}"}

    def _read_raw_activity_by_id(self, activity_id: int) -> dict[str, Any]:
        """Fetch raw activity data from Strava API"""

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
                headers=self._headers,
                timeout=self._api_config.request_timeout,
            )

        resp = _fetch()
        if not resp.ok:
            logger.error(
                "Failed to fetch activity %s: %s",
                activity_id,
                resp.status_code,
                extra={
                    "operation": "fetch_activity",
                    "activity_id": activity_id,
                    "status_code": resp.status_code,
                },
            )
            if resp.status_code == 404:
                raise ActivityNotFoundError(f"Activity {activity_id} not found")
            else:
                resp.raise_for_status()

        logger.info(
            "Activity %s successfully fetched",
            activity_id,
            extra={
                "operation": "fetch_activity",
                "activity_id": activity_id,
                "status_code": resp.status_code,
            },
        )
        return resp.json()

    def read_activity_by_id(self, activity_id: int) -> MinimalStravaActivity:
        """Fetch minimal activity data from Strava

        Only extracts the fields needed for aggregation (id, type, date, distance).
        Much faster validation than DetailedStravaActivity.
        """
        resp = self._read_raw_activity_by_id(activity_id)
        # Only extract minimal fields from response
        minimal_data = {
            "id": resp["id"],
            "type": resp["type"],
            "start_date_local": resp["start_date_local"],
            "distance": resp["distance"],
        }
        activity = MinimalStravaActivity(**minimal_data)
        return activity

    def read_activities_by_year(self, year: int) -> list[MinimalStravaActivity]:
        """Read minimal Strava activities in a year

        Note: Currently not implemented as aggregator doesn't use this method.
        """
        raise NotImplementedError("Aggregator doesn't fetch activities by year")
