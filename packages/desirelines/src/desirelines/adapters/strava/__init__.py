from functools import lru_cache

from desirelines.adapters.strava._repositories import (
    StravaActivitiesRepo,
    StravaTokenRepo,
)
from desirelines.config import AggregatorConfig
from desirelines.domain import StravaTokenSet
from desirelines.ports.out.read import ReadActivities


def make_read_strava_token(config: AggregatorConfig):
    strava_token_set = StravaTokenSet(
        client_id=config.strava_client_id,
        client_secret=config.strava_client_secret,
        refresh_token=config.strava_refresh_token,
        access_token="",  # Will be refreshed on first use
    )
    return StravaTokenRepo(strava_token_set)


@lru_cache(maxsize=1)
def make_read_strava_activities(strava_tokens: StravaTokenSet) -> ReadActivities:
    return StravaActivitiesRepo(strava_tokens)
