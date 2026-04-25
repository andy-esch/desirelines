"""Unit tests for common configuration utilities."""

from unittest.mock import patch

from stravapipe.config.common import load_secrets_from_volumes, load_strava_secrets


def _write_secret(base_path, name: str, value: str) -> None:
    secret_dir = base_path / name
    secret_dir.mkdir(parents=True, exist_ok=True)
    (secret_dir / "value").write_text(value)


def test_load_secrets_from_volumes_success(tmp_path):
    """Secrets present on disk are returned by name."""
    _write_secret(tmp_path, "MY_SECRET", "secret-value")

    secrets = load_secrets_from_volumes(["MY_SECRET"], base_path=str(tmp_path))

    assert secrets == {"MY_SECRET": "secret-value"}


def test_load_secrets_from_volumes_missing_file(tmp_path):
    """Missing secret files are gracefully skipped."""
    secrets = load_secrets_from_volumes(["MISSING_SECRET"], base_path=str(tmp_path))

    assert secrets == {}


def test_load_secrets_from_volumes_multiple(tmp_path):
    """Multiple secrets are loaded independently."""
    _write_secret(tmp_path, "SECRET_1", "value-1")
    _write_secret(tmp_path, "SECRET_2", "value-2")

    secrets = load_secrets_from_volumes(
        ["SECRET_1", "SECRET_2"], base_path=str(tmp_path)
    )

    assert secrets["SECRET_1"] == "value-1"
    assert secrets["SECRET_2"] == "value-2"


def test_load_strava_secrets(tmp_path):
    """Infrastructure secret names get remapped to application config keys."""
    _write_secret(tmp_path, "INFISICAL_STRAVA_CLIENT_ID", "12345")
    _write_secret(tmp_path, "INFISICAL_STRAVA_CLIENT_SECRET", "secret-abc")

    # load_strava_secrets() hardcodes the /etc/secrets base path via its call
    # to load_secrets_from_volumes(), so patch that helper to use tmp_path.
    with patch(
        "stravapipe.config.common.load_secrets_from_volumes"
    ) as mock_load_secrets:
        mock_load_secrets.return_value = {
            "INFISICAL_STRAVA_CLIENT_ID": "12345",
            "INFISICAL_STRAVA_CLIENT_SECRET": "secret-abc",
        }
        secrets = load_strava_secrets()

    assert secrets == {
        "strava_client_id": "12345",
        "strava_client_secret": "secret-abc",
    }
