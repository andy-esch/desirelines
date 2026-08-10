"""PostgreSQL connection string loading and validation.

Handles loading connection strings from Cloud Run secret volumes or environment
variables, validates required parameters, and transforms to SQLAlchemy dialect.
"""

import os
from pathlib import Path
import re
from typing import NamedTuple
from urllib.parse import parse_qs, urlparse


class ConnectionStringError(Exception):
    """Invalid or missing connection string configuration."""


# Cloud Run secret mount path (Infisical-managed secrets use INFISICAL_ prefix)
_SECRET_PATH = "/etc/secrets/INFISICAL_POSTGRES_CONN_WRITER/value"

# Environment variable name
_ENV_VAR = "POSTGRES_CONNECTION_STRING"


class PoolStrategy:
    """Connection pool strategy constants.

    Determines whether to use client-side connection pooling based on
    the database provider's capabilities.

    Strategies:
        EXTERNAL: Database has built-in pooler (Neon, PgBouncer, etc.)
                  Uses NullPool - no client-side pooling.
        INTERNAL: No external pooler (self-hosted, Cloud SQL direct)
                  Uses QueuePool with conservative settings.
        AUTO:     Auto-detect from connection string.
                  If hostname contains '-pooler', assumes external pooler.
    """

    EXTERNAL = "external"
    INTERNAL = "internal"
    AUTO = "auto"


class PoolConfig(NamedTuple):
    """SQLAlchemy connection pool configuration.

    Supports two pooling strategies for provider flexibility:

    1. EXTERNAL (Neon, PgBouncer, etc.):
       - Uses NullPool (no client-side pooling)
       - Let the external pooler manage connections
       - Avoids "pool on pool" anti-pattern

    2. INTERNAL (self-hosted, Cloud SQL direct):
       - Uses QueuePool with conservative settings
       - pool_size=2, max_overflow=3 (5 max per instance)
       - Suitable for horizontal scaling (20 instances = 100 connections)

    Environment variables:
        POSTGRES_POOL_STRATEGY: "external", "internal", or "auto" (default: "auto")
        POSTGRES_POOL_SIZE: Base pool size for internal strategy (default: 2)
        POSTGRES_MAX_OVERFLOW: Overflow connections for internal strategy (default: 3)
        POSTGRES_POOL_RECYCLE: Connection recycle time in seconds (default: 1800)
        POSTGRES_POOL_PRE_PING: Test connections before use (default: true)

    Migration guide:
        - Neon with -pooler endpoint: strategy=auto or external (recommended)
        - Neon direct endpoint: strategy=internal
        - Cloud SQL with proxy: strategy=external
        - Cloud SQL direct: strategy=internal
        - Self-hosted with PgBouncer: strategy=external
        - Self-hosted direct: strategy=internal
    """

    strategy: str = PoolStrategy.AUTO
    pool_size: int = 2
    max_overflow: int = 3
    pool_recycle: int = 1800  # 30 minutes
    pool_pre_ping: bool = True
    # Server-side per-statement cap. Without it a stuck query holds its
    # connection for as long as the client waits, so the request timeout budget
    # leaks at the database boundary. 30s sits below Cloud Run's 60s request cap
    # so Postgres gives up first and the caller gets a real error to log.
    statement_timeout_ms: int = 30_000
    # Bounds a session parked inside an open transaction. statement_timeout does
    # not cover this: a transaction that BEGINs then stalls between statements
    # runs no statement while still pinning a connection and holding its locks.
    # Above statement_timeout so a slow-but-progressing transaction isn't killed
    # by the wrong limit. Either may be set to 0 to disable.
    idle_in_transaction_timeout_ms: int = 60_000

    @classmethod
    def from_env(cls) -> "PoolConfig":
        """Load pool configuration from environment variables.

        Returns:
            PoolConfig with values from environment or defaults.
        """
        return cls(
            strategy=os.environ.get(
                "POSTGRES_POOL_STRATEGY", PoolStrategy.AUTO
            ).lower(),
            pool_size=int(os.environ.get("POSTGRES_POOL_SIZE", "2")),
            max_overflow=int(os.environ.get("POSTGRES_MAX_OVERFLOW", "3")),
            pool_recycle=int(os.environ.get("POSTGRES_POOL_RECYCLE", "1800")),
            pool_pre_ping=os.environ.get("POSTGRES_POOL_PRE_PING", "true").lower()
            == "true",
            statement_timeout_ms=int(
                os.environ.get("POSTGRES_STATEMENT_TIMEOUT_MS", "30000")
            ),
            idle_in_transaction_timeout_ms=int(
                os.environ.get("POSTGRES_IDLE_IN_TXN_TIMEOUT_MS", "60000")
            ),
        )

    def server_settings_options(self) -> str:
        """Render the server-side timeouts as a libpq ``options`` string.

        Returns an empty string when both timeouts are disabled (0), so callers
        can skip passing ``options`` entirely rather than sending an empty one.
        """
        settings: list[str] = []
        if self.statement_timeout_ms > 0:
            settings.append(f"-c statement_timeout={self.statement_timeout_ms}")
        if self.idle_in_transaction_timeout_ms > 0:
            settings.append(
                "-c idle_in_transaction_session_timeout="
                f"{self.idle_in_transaction_timeout_ms}"
            )
        return " ".join(settings)

    def uses_external_pooler(self, database_url: str) -> bool:
        """Determine if external pooler is in use.

        Args:
            database_url: PostgreSQL connection string

        Returns:
            True if external pooler detected/configured, False otherwise.
        """
        if self.strategy == PoolStrategy.EXTERNAL:
            return True
        if self.strategy == PoolStrategy.INTERNAL:
            return False

        # AUTO: detect from connection string
        # Neon pooled endpoints contain "-pooler" in the hostname
        try:
            parsed = urlparse(database_url)
            hostname = parsed.hostname or ""
        except Exception:
            return False  # Default to internal pooling if parsing fails
        return "-pooler" in hostname


def load_connection_string() -> str:
    """Load PostgreSQL connection string from secret or environment variable.

    Reads from Cloud Run secret volume first, falls back to environment variable.
    Validates that application_name is present for observability.
    Transforms standard postgresql:// to SQLAlchemy's postgresql+psycopg:// dialect.

    Returns:
        Connection string ready for SQLAlchemy with psycopg3 driver.

    Raises:
        ConnectionStringError: If connection string is missing or invalid.
    """
    conn_str = _read_raw_connection_string()
    _validate_connection_string(conn_str)
    return _transform_dialect(conn_str)


def _read_raw_connection_string() -> str:
    """Read connection string from secret mount or environment variable.

    Priority:
    1. Secret volume at ``_SECRET_PATH``
       (``/etc/secrets/INFISICAL_POSTGRES_CONN_WRITER/value``, Cloud Run / Infisical)
    2. ``POSTGRES_CONNECTION_STRING`` environment variable (local dev)

    Returns:
        Raw connection string as stored.

    Raises:
        ConnectionStringError: If no connection string found.
    """
    # Try secret mount first (Cloud Run)
    secret_path = Path(_SECRET_PATH)
    if secret_path.exists():
        conn_str = secret_path.read_text(encoding="utf-8").strip()
        if conn_str:
            return conn_str

    # Fallback to environment variable (local dev)
    conn_str = os.environ.get(_ENV_VAR, "").strip()
    if conn_str:
        return conn_str

    raise ConnectionStringError(
        f"No PostgreSQL connection string found. "
        f"Set {_ENV_VAR} environment variable or mount secret at {_SECRET_PATH}"
    )


def _validate_connection_string(conn_str: str) -> None:
    """Validate connection string has required parameters.

    Checks:
    - Valid URL format
    - application_name parameter present (required for observability)

    Args:
        conn_str: PostgreSQL connection string to validate.

    Raises:
        ConnectionStringError: If validation fails.
    """
    try:
        parsed = urlparse(conn_str)
    except Exception as e:
        # Don't include original exception - it may contain credentials
        raise ConnectionStringError(
            "Invalid connection string URL format (details redacted for security)"
        ) from e

    # Validate scheme
    if parsed.scheme not in ("postgresql", "postgresql+psycopg"):
        raise ConnectionStringError(
            f"Invalid scheme '{parsed.scheme}'. Expected 'postgresql' or 'postgresql+psycopg'"
        )

    # Validate application_name is present and valid
    params = parse_qs(parsed.query)
    if "application_name" not in params:
        raise ConnectionStringError(
            "Connection string must include 'application_name' parameter for observability. "
            "Example: postgresql://user:pass@host/db?sslmode=require&application_name=my-service"
        )

    # parse_qs never yields an empty value list for a key it reports, and the
    # missing-key case raised above, so indexing [0] is safe here.
    _validate_application_name(params["application_name"][0])


# Valid characters for application_name: alphanumeric, hyphen, underscore
_APP_NAME_PATTERN = r"^[a-zA-Z0-9_-]+$"
_APP_NAME_MAX_LENGTH = 63  # PostgreSQL truncates application_name at NAMEDATALEN-1 = 63


def _validate_application_name(app_name: str) -> None:
    """Validate application_name value for observability safety.

    Args:
        app_name: The application_name parameter value.

    Raises:
        ConnectionStringError: If application_name is invalid.
    """
    if not app_name:
        raise ConnectionStringError("application_name cannot be empty")

    if len(app_name) > _APP_NAME_MAX_LENGTH:
        raise ConnectionStringError(
            f"application_name exceeds {_APP_NAME_MAX_LENGTH} characters "
            f"(PostgreSQL will truncate)"
        )

    if not re.match(_APP_NAME_PATTERN, app_name):
        raise ConnectionStringError(
            "application_name must contain only alphanumeric characters, "
            "hyphens, and underscores (a-z, A-Z, 0-9, -, _)"
        )


def _transform_dialect(conn_str: str) -> str:
    """Transform standard PostgreSQL URL to SQLAlchemy psycopg3 dialect.

    SQLAlchemy requires 'postgresql+psycopg://' to use the psycopg3 driver.
    Standard 'postgresql://' defaults to psycopg2 which we don't use.

    Args:
        conn_str: Connection string (may already have dialect prefix).

    Returns:
        Connection string with postgresql+psycopg:// scheme.
    """
    if conn_str.startswith("postgresql://"):
        return conn_str.replace("postgresql://", "postgresql+psycopg://", 1)
    return conn_str
