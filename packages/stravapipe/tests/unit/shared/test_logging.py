"""Unit tests for the logging setup module.

Focused on the parts that are independently testable without spinning up the
full Cloud Logging client (which requires GCP credentials). The setup_logging
function itself is exercised indirectly by every test in this suite via the
shared conftest.
"""

import logging
from unittest.mock import MagicMock, patch

import pytest

import stravapipe.shared.logging as logging_module
from stravapipe.shared.logging import (
    _parse_log_level,
    log_best_effort,
    setup_logging,
)


def test_log_best_effort_swallows_observability_failure():
    callback = MagicMock(side_effect=RuntimeError("handler unavailable"))

    log_best_effort(callback)

    callback.assert_called_once_with()


class TestParseLogLevel:
    """Pins down the LOG_LEVEL contract: case-insensitive standard names map
    to logging constants; anything else falls back to INFO so a typo at deploy
    time can't silently disable logging."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("DEBUG", logging.DEBUG),
            ("INFO", logging.INFO),
            ("WARNING", logging.WARNING),
            ("ERROR", logging.ERROR),
            ("CRITICAL", logging.CRITICAL),
        ],
    )
    def test_recognized_names(self, value: str, expected: int, monkeypatch):
        monkeypatch.setenv("LOG_LEVEL", value)
        assert _parse_log_level() == expected

    @pytest.mark.parametrize("value", ["debug", "Info", "warning", "Error"])
    def test_case_insensitive(self, value: str, monkeypatch):
        monkeypatch.setenv("LOG_LEVEL", value)
        assert _parse_log_level() == logging.getLevelNamesMapping()[value.upper()]

    def test_unset_defaults_to_info(self, monkeypatch):
        monkeypatch.delenv("LOG_LEVEL", raising=False)
        assert _parse_log_level() == logging.INFO

    def test_invalid_value_falls_back_to_info(self, monkeypatch, caplog):
        monkeypatch.setenv("LOG_LEVEL", "VERBOSE")
        with caplog.at_level(logging.WARNING):
            assert _parse_log_level() == logging.INFO
        # Ensure operator gets a signal that the value was rejected — silent
        # fallback would mask deploy-time misconfiguration.
        assert any("Invalid LOG_LEVEL" in r.message for r in caplog.records)

    def test_empty_string_defaults_to_info_silently(self, monkeypatch, caplog):
        # Empty env var is the idiomatic Unix "unset" — treat as INFO and
        # do NOT warn. An operator who sets LOG_LEVEL="" to clear the var
        # shouldn't see a misconfiguration warning.
        monkeypatch.setenv("LOG_LEVEL", "")
        with caplog.at_level(logging.WARNING):
            assert _parse_log_level() == logging.INFO
        assert not any("Invalid LOG_LEVEL" in r.message for r in caplog.records)


class TestSetupLoggingIdempotency:
    """Pin down the once-per-process handler-install contract.

    ``google.cloud.logging.Client().setup_logging()`` attaches a fresh
    handler on every call; calling ``setup_logging()`` from multiple
    modules at import time used to multiply each log record by the
    number of callers (each handler emits independently). The
    idempotency guard exists to prevent that regression.
    """

    def test_install_runs_once_across_multiple_calls(self, monkeypatch):
        # Reset the module-level state so the test isn't sensitive to
        # whether other tests in the same process already triggered install.
        monkeypatch.setitem(logging_module._state, "handlers_installed", False)
        with patch.object(logging_module, "_install_handlers") as mock_install:
            setup_logging("a")
            setup_logging("b")
            setup_logging("c")
        mock_install.assert_called_once()

    def test_subsequent_calls_still_return_adapters(self, monkeypatch):
        monkeypatch.setitem(logging_module._state, "handlers_installed", False)
        with patch.object(logging_module, "_install_handlers"):
            first = setup_logging("a")
            second = setup_logging("b")
        # Each call returns an adapter wrapping the named logger; the
        # idempotency guard skips handler install but doesn't skip the
        # adapter construction.
        assert first.logger.name == "a"
        assert second.logger.name == "b"
