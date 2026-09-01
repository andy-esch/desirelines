"""Shared base for the postgres-backed Cloud Run service configs.

`PostgresWriterConfig` and `DeletionServiceConfig` are separate services with
separate env contracts, but every postgres-backed service needs the same four
settings and the same loading rule (read the connection string through
`load_connection_string`, then let pydantic-settings fill the rest from the
environment). Both had their own copy; adding a third service meant a third.

Only the genuinely common parts live here. Service-specific fields — the
writer's `environment` / `enable_cloud_logging`, the deletion service's
`gcp_bigquery_dataset` / `firestore_database` — stay on their own subclass,
because they are contract differences rather than duplication.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from stravapipe.adapters.postgres._connection import load_connection_string


class PostgresServiceConfig(BaseSettings):
    """Settings shared by every postgres-backed Cloud Run service."""

    # GCP configuration
    gcp_project_id: str

    # Environment
    log_level: str = "INFO"

    # Database configuration
    postgres_connection_string: str = Field(description="PostgreSQL connection string")

    # Readiness probe timeout in seconds (per-attempt; the helper retries once
    # after a short backoff). Override via READINESS_TIMEOUT env var.
    readiness_timeout: float = 10.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


def load_postgres_service_config[ConfigT: PostgresServiceConfig](
    config_cls: type[ConfigT],
) -> ConfigT:
    """Load and validate a postgres-backed service config.

    Priority order:
    1. Environment variables
    2. .env file (if present)

    The connection string is loaded via `load_connection_string()` rather than
    read straight from the environment: that reads the secret volume or env var,
    validates `application_name`, and rewrites `postgresql://` to
    `postgresql+psycopg://`.

    Raises:
        ValidationError: If required configuration is missing or invalid.
        ConnectionStringError: If the PostgreSQL connection string is missing
            or invalid.
    """
    config_dict: dict[str, str] = {
        "postgres_connection_string": load_connection_string()
    }
    return config_cls.model_validate(config_dict)
