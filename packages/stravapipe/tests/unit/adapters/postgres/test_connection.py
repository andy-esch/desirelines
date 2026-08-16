"""Unit tests for PostgreSQL connection string handling."""

import os
from unittest.mock import patch

import pytest

from stravapipe.adapters.postgres._connection import (
    ConnectionStringError,
    PoolConfig,
    _read_raw_connection_string,
    _transform_dialect,
    _validate_connection_string,
    load_connection_string,
)


class TestReadRawConnectionString:
    """Tests for _read_raw_connection_string."""

    def test_reads_from_secret_file_when_exists(self, tmp_path):
        """Should read from secret file when it exists."""
        secret_file = tmp_path / "connection_string"
        secret_file.write_text("postgresql://user:pass@host/db")
        secret_file.chmod(0o600)

        with patch(
            "stravapipe.adapters.postgres._connection._SECRET_PATH",
            str(secret_file),
        ):
            result = _read_raw_connection_string()

        assert result == "postgresql://user:pass@host/db"

    def test_strips_whitespace_from_secret_file(self, tmp_path):
        """Should strip leading/trailing whitespace from secret file."""
        secret_file = tmp_path / "connection_string"
        secret_file.write_text("  postgresql://user:pass@host/db\n\n")
        secret_file.chmod(0o600)

        with patch(
            "stravapipe.adapters.postgres._connection._SECRET_PATH",
            str(secret_file),
        ):
            result = _read_raw_connection_string()

        assert result == "postgresql://user:pass@host/db"

    def test_falls_back_to_env_var_when_no_secret_file(self):
        """Should fall back to env var when secret file doesn't exist."""
        with (
            patch(
                "stravapipe.adapters.postgres._connection._SECRET_PATH",
                "/nonexistent/path",
            ),
            patch.dict(
                os.environ,
                {"POSTGRES_CONNECTION_STRING": "postgresql://env@host/db"},
            ),
        ):
            result = _read_raw_connection_string()

        assert result == "postgresql://env@host/db"

    def test_raises_when_no_connection_string_found(self):
        """Should raise ConnectionStringError when no connection string found."""
        with (
            patch(
                "stravapipe.adapters.postgres._connection._SECRET_PATH",
                "/nonexistent/path",
            ),
            patch.dict(os.environ, {}, clear=True),
            pytest.raises(ConnectionStringError) as exc_info,
        ):
            _read_raw_connection_string()

        assert "No PostgreSQL connection string found" in str(exc_info.value)

    def test_prefers_secret_file_over_env_var(self, tmp_path):
        """Should prefer secret file when both are available."""
        secret_file = tmp_path / "connection_string"
        secret_file.write_text("postgresql://secret@host/db")
        secret_file.chmod(0o600)

        with (
            patch(
                "stravapipe.adapters.postgres._connection._SECRET_PATH",
                str(secret_file),
            ),
            patch.dict(
                os.environ,
                {"POSTGRES_CONNECTION_STRING": "postgresql://env@host/db"},
            ),
        ):
            result = _read_raw_connection_string()

        assert result == "postgresql://secret@host/db"


class TestValidateConnectionString:
    """Tests for _validate_connection_string."""

    def test_valid_connection_string_with_application_name(self):
        """Should accept valid connection string with application_name."""
        conn_str = (
            "postgresql://user:pass@host/db?sslmode=require&application_name=my-service"
        )
        # Should not raise
        _validate_connection_string(conn_str)

    def test_valid_with_psycopg_dialect(self):
        """Should accept postgresql+psycopg:// dialect."""
        conn_str = "postgresql+psycopg://user:pass@host/db?application_name=svc"
        # Should not raise
        _validate_connection_string(conn_str)

    def test_raises_when_missing_application_name(self):
        """Should raise when application_name is missing."""
        conn_str = "postgresql://user:pass@host/db?sslmode=require"

        with pytest.raises(ConnectionStringError) as exc_info:
            _validate_connection_string(conn_str)

        assert "application_name" in str(exc_info.value)
        assert "observability" in str(exc_info.value)

    def test_raises_for_invalid_scheme(self):
        """Should raise for invalid URL scheme."""
        conn_str = "mysql://user:pass@host/db?application_name=svc"

        with pytest.raises(ConnectionStringError) as exc_info:
            _validate_connection_string(conn_str)

        assert "Invalid scheme" in str(exc_info.value)

    def test_accepts_application_name_with_special_chars(self):
        """Should accept application_name with dashes and underscores."""
        conn_str = "postgresql://user:pass@host/db?application_name=my-service_v2"
        # Should not raise
        _validate_connection_string(conn_str)

    def test_application_name_length_boundary_at_63(self):
        """63 chars is the max PostgreSQL keeps (NAMEDATALEN-1); 64 is rejected
        because PostgreSQL would silently truncate it."""
        ok = "a" * 63
        _validate_connection_string(
            f"postgresql://user:pass@host/db?application_name={ok}"
        )  # exactly 63: no raise

        too_long = "a" * 64
        with pytest.raises(ConnectionStringError) as exc_info:
            _validate_connection_string(
                f"postgresql://user:pass@host/db?application_name={too_long}"
            )
        assert "63" in str(exc_info.value)


class TestTransformDialect:
    """Tests for _transform_dialect."""

    def test_transforms_postgresql_to_psycopg(self):
        """Should transform postgresql:// to postgresql+psycopg://."""
        conn_str = "postgresql://user:pass@host/db?application_name=svc"
        result = _transform_dialect(conn_str)
        assert result == "postgresql+psycopg://user:pass@host/db?application_name=svc"

    def test_preserves_already_transformed(self):
        """Should preserve already transformed connection string."""
        conn_str = "postgresql+psycopg://user:pass@host/db?application_name=svc"
        result = _transform_dialect(conn_str)
        assert result == conn_str

    def test_only_transforms_first_occurrence(self):
        """Should only transform the scheme prefix, not other occurrences."""
        # Edge case: postgresql in password (unlikely but possible)
        conn_str = "postgresql://user:postgresql@host/db?application_name=svc"
        result = _transform_dialect(conn_str)
        assert (
            result
            == "postgresql+psycopg://user:postgresql@host/db?application_name=svc"
        )


class TestLoadConnectionString:
    """Integration tests for load_connection_string."""

    def test_full_flow_from_env_var(self):
        """Should load, validate, and transform from env var."""
        conn_str = "postgresql://writer:pass@host/db?sslmode=require&application_name=postgres-writer"

        with (
            patch(
                "stravapipe.adapters.postgres._connection._SECRET_PATH",
                "/nonexistent/path",
            ),
            patch.dict(os.environ, {"POSTGRES_CONNECTION_STRING": conn_str}),
        ):
            result = load_connection_string()

        assert result.startswith("postgresql+psycopg://")
        assert "application_name=postgres-writer" in result

    def test_raises_for_missing_application_name(self):
        """Should raise early if application_name is missing."""
        conn_str = "postgresql://writer:pass@host/db?sslmode=require"

        with (
            patch(
                "stravapipe.adapters.postgres._connection._SECRET_PATH",
                "/nonexistent/path",
            ),
            patch.dict(os.environ, {"POSTGRES_CONNECTION_STRING": conn_str}),
            pytest.raises(ConnectionStringError) as exc_info,
        ):
            load_connection_string()

        assert "application_name" in str(exc_info.value)


class TestSessionTimeoutSettings:
    """Tests for PoolConfig.session_timeout_settings."""

    def test_returns_both_timeouts_by_default(self):
        """Should emit both GUCs as (name, value) pairs with defaults."""
        assert PoolConfig().session_timeout_settings() == (
            ("statement_timeout", "30000"),
            ("idle_in_transaction_session_timeout", "60000"),
        )

    def test_omits_disabled_statement_timeout(self):
        """Should drop statement_timeout when set to 0."""
        config = PoolConfig(statement_timeout_ms=0)
        assert config.session_timeout_settings() == (
            ("idle_in_transaction_session_timeout", "60000"),
        )

    def test_omits_disabled_idle_in_transaction_timeout(self):
        """Should drop idle_in_transaction_session_timeout when set to 0."""
        config = PoolConfig(idle_in_transaction_timeout_ms=0)
        assert config.session_timeout_settings() == (("statement_timeout", "30000"),)

    def test_empty_when_both_disabled(self):
        """Both knobs at 0 is the escape hatch: no settings to apply at all."""
        config = PoolConfig(
            statement_timeout_ms=0,
            idle_in_transaction_timeout_ms=0,
        )
        assert config.session_timeout_settings() == ()

    # The "never reaches the startup packet" invariant is guarded where it can
    # actually fail — test_unit_of_work.py's check on create_engine's
    # connect_args. Asserting it against these literals proves nothing.
