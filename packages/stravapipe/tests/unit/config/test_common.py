"""Unit tests for common configuration utilities."""

from unittest.mock import mock_open, patch

from stravapipe.config.common import load_secrets_from_volumes, load_strava_secrets


def test_load_secrets_from_volumes_success():
    """Test loading secrets when files exist."""
    secret_names = ["MY_SECRET"]
    base_path = "/secrets"

    # Mock opening /secrets/MY_SECRET/value
    with patch("builtins.open", mock_open(read_data="secret-value")):
        secrets = load_secrets_from_volumes(secret_names, base_path)

    assert secrets == {"MY_SECRET": "secret-value"}


def test_load_secrets_from_volumes_missing_file():
    """Test that missing files are gracefully skipped."""
    secret_names = ["MISSING_SECRET"]

    with patch("builtins.open", side_effect=FileNotFoundError):
        secrets = load_secrets_from_volumes(secret_names)

    assert secrets == {}


def test_load_secrets_from_volumes_multiple():
    """Test loading multiple secrets."""
    secret_names = ["SECRET_1", "SECRET_2"]

    def mock_file_open(file, *args, **kwargs):
        if "SECRET_1" in file:
            return mock_open(read_data="value-1").return_value
        if "SECRET_2" in file:
            return mock_open(read_data="value-2").return_value
        raise FileNotFoundError

    with patch("builtins.open", side_effect=mock_file_open):
        secrets = load_secrets_from_volumes(secret_names)

    assert secrets["SECRET_1"] == "value-1"
    assert secrets["SECRET_2"] == "value-2"


def test_load_strava_secrets(monkeypatch):
    """Test loading and mapping of Strava secrets."""

    # Mock file reading to return some secrets and miss others
    def mock_file_open(file, *args, **kwargs):
        if "INFISICAL_STRAVA_CLIENT_ID" in file:
            return mock_open(read_data="12345").return_value
        if "INFISICAL_STRAVA_CLIENT_SECRET" in file:
            return mock_open(read_data="secret-abc").return_value
        raise FileNotFoundError

    # Mock environment variable for the missing secret
    monkeypatch.setenv("STRAVA_REFRESH_TOKEN", "refresh-xyz")

    with patch("builtins.open", side_effect=mock_file_open):
        secrets = load_strava_secrets()

    # Verify keys are remapped correctly
    assert secrets == {
        "strava_client_id": "12345",
        "strava_client_secret": "secret-abc",
    }
    # Note: Env vars are logged but NOT added to the returned dictionary
    # because load_strava_secrets currently only returns what was found in volumes.
    # The config class (Pydantic) handles the env var fallback separately.
    # Wait, the logic in load_strava_secrets says:
    # "Log fallbacks... return {remapped keys from volumes}"
    # So the return value should ONLY contain the volume secrets.

    assert "strava_refresh_token" not in secrets
