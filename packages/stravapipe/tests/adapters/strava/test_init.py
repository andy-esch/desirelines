import pytest
from stravapipe.adapters.strava import (
    make_read_detailed_activities,
    make_read_strava_token,
)
from stravapipe.adapters.strava._repositories import (
    DetailedStravaActivitiesRepo,
    StravaTokenRepo,
)
from stravapipe.domain import StravaTokenSet


@pytest.fixture
def sample_tokens():
    return StravaTokenSet(
        client_id=123,
        client_secret="test_secret",
        access_token="test_access",
        refresh_token="test_refresh",
    )


class TestStravaAdapterFactories:
    def test_make_read_strava_token_returns_correct_type(self, sample_tokens):
        result = make_read_strava_token(sample_tokens)
        assert isinstance(result, StravaTokenRepo)

    def test_make_read_activities_returns_correct_type(self, sample_tokens):
        result = make_read_detailed_activities(sample_tokens)
        assert isinstance(result, DetailedStravaActivitiesRepo)

    def test_make_read_activities_different_tokens_different_instances(self):
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

        result1 = make_read_detailed_activities(tokens1)
        result2 = make_read_detailed_activities(tokens2)
        assert result1 is not result2

    def test_make_read_strava_token_uses_app_config(self, sample_tokens):
        # Test that factory creates repo with expected attributes
        repo = make_read_strava_token(sample_tokens)
        # Verify it has the expected tokens from app_config
        assert hasattr(repo, "_tokens")
        assert hasattr(repo, "_api_config")
        assert repo._tokens == sample_tokens

    def test_make_read_activities_uses_app_config(self, sample_tokens):
        # Test that factory passes api config
        repo = make_read_detailed_activities(sample_tokens)
        assert hasattr(repo, "_tokens")
        assert hasattr(repo, "_api_config")
        assert repo._tokens == sample_tokens
