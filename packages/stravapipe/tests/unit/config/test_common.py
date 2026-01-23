"""Unit tests for common configuration utilities."""

from unittest.mock import mock_open, patch

from stravapipe.config.common import load_secrets_from_volumes


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
