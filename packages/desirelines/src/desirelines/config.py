"""Function-specific configurations for cloud functions"""

from pydantic_settings import BaseSettings


class AggregatorConfig(BaseSettings):
    """Configuration for the activity aggregator cloud function"""

    # GCP configuration
    gcp_project_id: str
    gcp_bucket_name: str

    # Strava API configuration (for fetching activity data)
    strava_client_id: int
    strava_client_secret: str
    strava_refresh_token: str

    # Optional configuration
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        validate_default = True
        extra = "ignore"  # Allow extra environment variables


def load_aggregator_config() -> AggregatorConfig:
    """Load and validate configuration for the aggregator function"""
    return AggregatorConfig()
