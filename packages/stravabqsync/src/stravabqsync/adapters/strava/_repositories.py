"""Strava read repositories"""

import logging
from typing import Any

import requests

from stravabqsync.config import StravaApiConfig
from stravabqsync.domain import StravaActivity, StravaTokenSet
from stravabqsync.exceptions import (
    ActivityNotFoundError,
    StravaApiError,
    StravaTokenError,
)
from stravabqsync.ports.out.read import ReadActivities, ReadStravaToken
from stravabqsync.retry import retry_on_failure

logger = logging.getLogger(__name__)


class StravaTokenRepo(ReadStravaToken):
    """Fetch new access token"""

    def __init__(self, tokens: StravaTokenSet, api_config: StravaApiConfig):
        self._tokens = tokens
        self._api_config = api_config

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
        logger.info("Tokens successfully updated")
        return StravaTokenSet(
            client_id=self._tokens.client_id,
            client_secret=self._tokens.client_secret,
            access_token=access_token,
            refresh_token=self._tokens.refresh_token,
        )


class StravaActivitiesRepo(ReadActivities):
    """Repository for fetching Strava Activities"""

    def __init__(self, tokens: StravaTokenSet, api_config: StravaApiConfig):
        # TODO: Document adapter-specific api_config parameter properly.
        # This adapter extends the port interface with additional configuration.
        self._tokens = tokens
        self._api_config = api_config
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
                "Failed to fetch activity %s: %s", activity_id, resp.status_code
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
        return resp.json()

    def read_activity_by_id(self, activity_id: int) -> StravaActivity:
        """Fetch an Activity from Strava. An activity is roughly Strava's
        DetailedActivity model:
          https://developers.strava.com/docs/reference/#api-models-DetailedActivity
        """
        resp = self._read_raw_activity_by_id(activity_id)
        activity = StravaActivity(**resp)
        return activity
