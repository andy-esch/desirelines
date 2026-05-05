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
        )

        # Test direct properties
        assert config.gcp_project_id == "test-project"
        assert config.gcp_bigquery_dataset == "test-dataset"
        assert config.log_level == "INFO"
        assert config.readiness_timeout_s == 10.0

        # Test compatibility properties
        assert config.project_id == "test-project"
        assert config.bq_dataset == "test-dataset"
