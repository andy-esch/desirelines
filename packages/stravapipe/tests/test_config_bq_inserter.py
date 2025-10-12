from stravapipe.config import BQInserterConfig, StravaApiConfig


class TestStravaApiConfig:
    def test_strava_api_config_defaults(self):
        config = StravaApiConfig()
        assert config.token_url == "https://www.strava.com/oauth/token"
        assert config.api_base_url == "https://www.strava.com/api/v3"
        assert config.request_timeout == 10
        assert config.token_retry_attempts == 2
        assert config.token_retry_backoff == 0.5
        assert config.activity_retry_attempts == 3
        assert config.activity_retry_backoff == 1.0


class TestBQInserterConfig:
    def test_bq_inserter_config_properties(self):
        config = BQInserterConfig(
            gcp_project_id="test-project",
            gcp_bigquery_dataset="test-dataset",
            strava_client_id=123,
            strava_client_secret="test-secret",
            strava_refresh_token="test-refresh-token",
        )

        # Test direct properties
        assert config.gcp_project_id == "test-project"
        assert config.gcp_bigquery_dataset == "test-dataset"
        assert config.strava_client_id == 123
        assert config.strava_client_secret == "test-secret"
        assert config.strava_refresh_token == "test-refresh-token"
        assert config.log_level == "INFO"

        # Test compatibility properties
        assert config.project_id == "test-project"
        assert config.bq_dataset == "test-dataset"

        # Test tokens property
        tokens = config.tokens
        assert tokens.client_id == 123
        assert tokens.client_secret == "test-secret"
        assert tokens.refresh_token == "test-refresh-token"
        assert tokens.access_token == ""

        # Test strava_api property
        strava_api = config.strava_api
        assert isinstance(strava_api, StravaApiConfig)
