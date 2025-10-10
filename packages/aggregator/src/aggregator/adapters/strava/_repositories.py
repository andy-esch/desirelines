"""Strava read repositories"""

from datetime import UTC, datetime
from functools import cached_property
import logging

import requests

from aggregator.domain import StravaActivity, StravaTokenSet
from aggregator.exceptions import ActivityNotFoundError
from aggregator.ports.out.read import ReadActivities, ReadStravaToken

logger = logging.getLogger(__name__)


class StravaTokenRepo(ReadStravaToken):
    """Fetch new access token"""

    def __init__(self, tokens: StravaTokenSet):
        self._tokens = tokens
        self._url = "https://www.strava.com/oauth/token"

    @cached_property
    def refresh(self) -> StravaTokenSet:
        payload = {
            "client_id": self._tokens.client_id,
            "client_secret": self._tokens.client_secret,
            "refresh_token": self._tokens.refresh_token,
            "grant_type": "refresh_token",
        }
        resp = requests.post(url=self._url, data=payload, timeout=10)

        if not resp.ok:
            resp.raise_for_status()

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

    def __init__(self, tokens: StravaTokenSet):
        self._tokens = tokens
        self._headers = {"Authorization": f"Bearer {self._tokens.access_token}"}
        self._activity_endpoint = (
            "https://www.strava.com/api/v3/activities/{activity_id}"
        )
        self._activities_endpoint = "https://www.strava.com/api/v3/activities"

    def _read_raw_activity_by_id(self, activity_id: int) -> dict:
        resp = requests.get(
            url=self._activity_endpoint.format(activity_id=activity_id),
            headers=self._headers,
            timeout=10,
        )

        # Handle 404 specifically
        #  Activity not found: deleted, never existed, or don't have access
        if resp.status_code == 404:
            raise ActivityNotFoundError(
                f"Activity {activity_id} not found in Strava API"
            )

        if not resp.ok:
            resp.raise_for_status()
        return resp.json()

    def read_activity_by_id(self, activity_id: int) -> StravaActivity:
        resp = self._read_raw_activity_by_id(activity_id)
        activity = StravaActivity(**resp)
        return activity

    def _read_activities(
        self, *, before: int, after: int, page: int, per_page: int = 100
    ) -> list[StravaActivity]:
        """Gather activities according to params"""
        resp = requests.get(
            url=self._activities_endpoint,
            headers=self._headers,
            params={
                "before": before,
                "after": after,
                "page": page,
                "per_page": per_page,
            },
            timeout=10,
        )
        if not resp.ok:
            resp.raise_for_status()
        activities = [StravaActivity(**activity) for activity in resp.json()]
        return activities

    def read_activities_by_year(self, year: int) -> list[StravaActivity]:
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
