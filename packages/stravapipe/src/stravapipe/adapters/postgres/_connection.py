"""PostgreSQL connection string loading and validation.

Handles loading connection strings from Cloud Run secret volumes or environment
variables, validates required parameters, and transforms to SQLAlchemy dialect.
"""

import os
import stat
from typing import NamedTuple
from urllib.parse import parse_qs, urlparse


class ConnectionStringError(Exception):
    """Invalid or missing connection string configuration."""


# Cloud Run secret mount path
_SECRET_PATH = "/etc/secrets/postgres/connection_string"

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

    @classmethod
    def from_env(cls) -> "PoolConfig":
        """Load pool configuration from environment variables.

        Returns:
            PoolConfig with values from environment or defaults.
        """
        return cls(
            strategy=os.environ.get("POSTGRES_POOL_STRATEGY", PoolStrategy.AUTO).lower(),
            pool_size=int(os.environ.get("POSTGRES_POOL_SIZE", "2")),
            max_overflow=int(os.environ.get("POSTGRES_MAX_OVERFLOW", "3")),
            pool_recycle=int(os.environ.get("POSTGRES_POOL_RECYCLE", "1800")),
            pool_pre_ping=os.environ.get("POSTGRES_POOL_PRE_PING", "true").lower() == "true",
        )

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
            return "-pooler" in hostname
        except Exception:
            return False  # Default to internal pooling if parsing fails


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


def _validate_secret_file_permissions(path: str) -> None:
    """Validate secret file has secure permissions.

    Secret files should only be readable by the owner (0600 or 0400)
    to prevent unauthorized access to credentials.

    Args:
        path: Path to the secret file.

    Raises:
        ConnectionStringError: If file permissions are too permissive.
    """
    file_stat = os.stat(path)
    mode = file_stat.st_mode

    # Check if group or others have any permissions
    # Allowed: 0400 (r--------) or 0600 (rw-------)
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        actual_perms = stat.filemode(mode)
        raise ConnectionStringError(
            f"Secret file {path} has insecure permissions ({actual_perms}). "
            f"Expected 0400 or 0600 (owner read/write only). "
            f"Fix with: chmod 600 {path}"
        )


def _read_raw_connection_string() -> str:
    """Read connection string from secret mount or environment variable.

    Priority:
    1. Secret volume at /etc/secrets/postgres/connection_string (Cloud Run)
    2. POSTGRES_CONNECTION_STRING environment variable (local dev)

    Returns:
        Raw connection string as stored.

    Raises:
        ConnectionStringError: If no connection string found.
    """
    # Try secret mount first (Cloud Run)
    if os.path.exists(_SECRET_PATH):
        _validate_secret_file_permissions(_SECRET_PATH)
        with open(_SECRET_PATH, encoding="utf-8") as f:
            conn_str = f.read().strip()
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
        raise ConnectionStringError(f"Invalid connection string URL: {e}") from e

    # Validate scheme
    if parsed.scheme not in ("postgresql", "postgresql+psycopg"):
        raise ConnectionStringError(
            f"Invalid scheme '{parsed.scheme}'. Expected 'postgresql' or 'postgresql+psycopg'"
        )

    # Validate application_name is present
    params = parse_qs(parsed.query)
    if "application_name" not in params:
        raise ConnectionStringError(
            "Connection string must include 'application_name' parameter for observability. "
            "Example: postgresql://user:pass@host/db?sslmode=require&application_name=my-service"
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
