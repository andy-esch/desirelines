"""PostgreSQL connection string loading and validation.

Handles loading connection strings from Cloud Run secret volumes or environment
variables, validates required parameters, and transforms to SQLAlchemy dialect.
"""

import os
from urllib.parse import parse_qs, urlparse


class ConnectionStringError(Exception):
    """Invalid or missing connection string configuration."""


# Cloud Run secret mount path
_SECRET_PATH = "/etc/secrets/postgres/connection_string"

# Environment variable name
_ENV_VAR = "POSTGRES_CONNECTION_STRING"


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
    1. Secret volume at /etc/secrets/postgres/connection_string (Cloud Run)
    2. POSTGRES_CONNECTION_STRING environment variable (local dev)

    Returns:
        Raw connection string as stored.

    Raises:
        ConnectionStringError: If no connection string found.
    """
    # Try secret mount first (Cloud Run)
    if os.path.exists(_SECRET_PATH):
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
