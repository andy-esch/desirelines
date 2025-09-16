from stravabqsync.adapters.strava._repositories import (
    StravaActivitiesRepo,
    StravaTokenRepo,
)
from stravabqsync.config import BQInserterConfig
from stravabqsync.domain import StravaTokenSet
from stravabqsync.ports.out.read import ReadActivities


def make_read_strava_token(config: BQInserterConfig):
    return StravaTokenRepo(config.tokens, config.strava_api)


def make_read_activities(
    strava_tokens: StravaTokenSet, config: BQInserterConfig
) -> ReadActivities:
    return StravaActivitiesRepo(strava_tokens, config.strava_api)
