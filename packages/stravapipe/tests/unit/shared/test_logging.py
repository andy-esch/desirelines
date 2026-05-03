"""Unit tests for the logging setup module.

Focused on the parts that are independently testable without spinning up the
full Cloud Logging client (which requires GCP credentials). The setup_logging
function itself is exercised indirectly by every test in this suite via the
shared conftest.
"""

import logging

import pytest

from stravapipe.shared.logging import _parse_log_level


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
