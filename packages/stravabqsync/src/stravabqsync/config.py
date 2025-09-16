"""Configuration for stravabqsync package"""

from typing import NamedTuple

from pydantic_settings import BaseSettings

from stravabqsync.domain import StravaTokenSet


class StravaApiConfig(NamedTuple):
    """Strava API configuration"""

    token_url: str = "https://www.strava.com/oauth/token"
    api_base_url: str = "https://www.strava.com/api/v3"
    request_timeout: int = 10
    token_retry_attempts: int = 2
    token_retry_backoff: float = 0.5
    activity_retry_attempts: int = 3
    activity_retry_backoff: float = 1.0


# Function-specific configuration for BQ Inserter cloud function


class BQInserterConfig(BaseSettings):
    """Configuration for the BigQuery inserter cloud function"""

    # GCP configuration
    gcp_project_id: str
    gcp_bigquery_dataset: str

    # Strava API configuration
    strava_client_id: int
    strava_client_secret: str
    strava_refresh_token: str

    # Optional configuration
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        validate_default = True
        extra = "ignore"  # Allow extra environment variables

    @property
    def tokens(self) -> StravaTokenSet:
        """Create StravaTokenSet from config values"""
        return StravaTokenSet(
            client_id=self.strava_client_id,
            client_secret=self.strava_client_secret,
            access_token="",  # Will be refreshed on first use
            refresh_token=self.strava_refresh_token,
        )

    @property
    def project_id(self) -> str:
        """Alias for gcp_project_id"""
        return self.gcp_project_id

    @property
    def bq_dataset(self) -> str:
        """Alias for gcp_bigquery_dataset"""
        return self.gcp_bigquery_dataset

    @property
    def strava_api(self) -> StravaApiConfig:
        """Create StravaApiConfig with defaults"""
        return StravaApiConfig()


def load_bq_inserter_config() -> BQInserterConfig:
    """Load and validate configuration for the BQ inserter function"""
    return BQInserterConfig()
