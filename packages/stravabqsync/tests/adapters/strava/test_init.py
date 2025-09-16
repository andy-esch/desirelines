import pytest

from stravabqsync.adapters.strava import make_read_activities, make_read_strava_token
from stravabqsync.adapters.strava._repositories import (
    StravaActivitiesRepo,
    StravaTokenRepo,
)
from stravabqsync.domain import StravaTokenSet


@pytest.fixture
def sample_tokens():
    return StravaTokenSet(
        client_id=123,
        client_secret="test_secret",
        access_token="test_access",
        refresh_token="test_refresh",
    )


class TestStravaAdapterFactories:
    def test_make_read_strava_token_returns_correct_type(self, mock_config):
        result = make_read_strava_token(mock_config)
        assert isinstance(result, StravaTokenRepo)

    def test_make_read_activities_returns_correct_type(
        self, sample_tokens, mock_config
    ):
        result = make_read_activities(sample_tokens, mock_config)
        assert isinstance(result, StravaActivitiesRepo)

    def test_make_read_activities_different_tokens_different_instances(
        self, mock_config
    ):
        # Test that different tokens return different instances
        tokens1 = StravaTokenSet(
            client_id=123,
            client_secret="secret1",
            access_token="access1",
            refresh_token="refresh1",
        )
        tokens2 = StravaTokenSet(
            client_id=456,
            client_secret="secret2",
            access_token="access2",
            refresh_token="refresh2",
        )

        result1 = make_read_activities(tokens1, mock_config)
        result2 = make_read_activities(tokens2, mock_config)
        assert result1 is not result2

    def test_make_read_strava_token_uses_app_config(self, mock_config):
        # Test that factory uses app_config values
        repo = make_read_strava_token(mock_config)
        # Verify it has the expected tokens from app_config
        assert hasattr(repo, "_tokens")
        assert hasattr(repo, "_api_config")

    def test_make_read_activities_uses_app_config(self, sample_tokens, mock_config):
        # Test that factory passes app_config.strava_api
        repo = make_read_activities(sample_tokens, mock_config)
        assert hasattr(repo, "_tokens")
        assert hasattr(repo, "_api_config")
        assert repo._tokens == sample_tokens
