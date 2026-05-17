"""Tests for sport configuration loader."""

import json
import logging

import pytest

from stravapipe.config.sport_config import (
    SUPPORTED_CONFIG_VERSIONS,
    UNKNOWN_SPORT_CATEGORY,
    UNKNOWN_SPORT_LOG_MESSAGE,
    SportConfig,
    load_sport_config,
)

# expectedSportCount is the number of sport categories in sport_types.json.
# Update this constant when adding/removing sports from the config.
# Current sports: cycling, ebike, running, walking, hiking, swimming, yoga,
# workout, watersports, winter_sports, golf, racket_sports, team_sports,
# skating, climbing, wheelchair, other
EXPECTED_SPORT_COUNT = 17


def test_categorize_activities():
    """Test activity type categorization."""
    config = load_sport_config()
    assert config.categorize_activity("Ride") == "cycling"
    assert config.categorize_activity("VirtualRide") == "cycling"
    assert config.categorize_activity("Run") == "running"
    assert config.categorize_activity("VirtualRun") == "running"
    assert config.categorize_activity("TrailRun") == "running"
    assert config.categorize_activity("Yoga") == "yoga"
    assert config.categorize_activity("EBikeRide") == "ebike"
    assert config.categorize_activity("Walk") == "walking"


def test_sport_properties():
    """Test sport category properties."""
    config = load_sport_config()

    # Cycling - distance-based sport
    cycling = config.get_category("cycling")
    assert cycling is not None
    assert cycling.has_distance is True
    assert cycling.has_elevation is True
    assert cycling.primary_metric == "distance_meters"
    assert "distance_meters" in cycling.metrics
    assert "time_minutes" in cycling.metrics

    # Running - distance-based sport
    running = config.get_category("running")
    assert running is not None
    assert running.has_distance is True
    assert running.has_elevation is True
    assert running.primary_metric == "distance_meters"

    # Yoga - time-based sport
    yoga = config.get_category("yoga")
    assert yoga is not None
    assert yoga.has_distance is False
    assert yoga.has_elevation is False
    assert yoga.primary_metric == "time_minutes"
    assert "distance_meters" not in yoga.metrics


def test_list_sports():
    """Test listing all configured sports."""
    config = load_sport_config()
    sports = config.list_sports()
    assert "cycling" in sports
    assert "running" in sports
    assert "yoga" in sports
    assert len(sports) == EXPECTED_SPORT_COUNT


def test_unsupported_version_fails(tmp_path):
    """Test that unsupported config versions are rejected.

    This test verifies that SportConfig raises ValueError for unsupported versions,
    consistent with Go's loadSportConfigInternal behavior.
    """
    config_data = {
        "version": "99.0",
        "sportCategories": {
            "cycling": {
                "displayName": "Cycling",
                "stravaTypes": ["Ride"],
                "excludedTypes": [],
                "primaryMetric": "distance_meters",
                "metrics": ["distance_meters"],
                "hasDistance": True,
                "hasElevation": True,
            }
        },
    }
    config_path = tmp_path / "sport_types.json"
    with config_path.open("w") as f:
        json.dump(config_data, f)

    with pytest.raises(ValueError, match=r"Unsupported sport config version: 99\.0"):
        SportConfig(config_path)


def test_unsupported_version_can_be_loaded_without_validation(tmp_path):
    """Test that validate_version=False allows loading unsupported versions.

    This is useful for testing version handling without triggering errors.
    """
    config_data = {
        "version": "99.0",
        "sportCategories": {
            "cycling": {
                "displayName": "Cycling",
                "stravaTypes": ["Ride"],
                "excludedTypes": [],
                "primaryMetric": "distance_meters",
                "metrics": ["distance_meters"],
                "hasDistance": True,
                "hasElevation": True,
            }
        },
    }
    config_path = tmp_path / "sport_types.json"
    with config_path.open("w") as f:
        json.dump(config_data, f)

    # Should not raise when validation is disabled
    config = SportConfig(config_path, validate_version=False)
    assert config.version == "99.0"
    assert config.version not in SUPPORTED_CONFIG_VERSIONS


def test_invalid_schema_fails(tmp_path):
    """Test that invalid config schemas are rejected."""
    # Missing required field: stravaTypes
    config_data = {
        "version": "1.0",
        "sportCategories": {"cycling": {"displayName": "Cycling"}},
    }
    config_path = tmp_path / "sport_types.json"
    with config_path.open("w") as f:
        json.dump(config_data, f)

    with pytest.raises(ValueError, match="Invalid sport config schema"):
        SportConfig(config_path)


def test_empty_strava_types_fails(tmp_path):
    """Test that empty strava_types list is rejected."""
    config_data = {
        "version": "1.0",
        "sportCategories": {
            "cycling": {
                "displayName": "Cycling",
                "stravaTypes": [],  # Empty list should fail
                "excludedTypes": [],
                "primaryMetric": "distance_meters",
                "metrics": ["distance_meters"],
                "hasDistance": True,
                "hasElevation": True,
            }
        },
    }
    config_path = tmp_path / "sport_types.json"
    with config_path.open("w") as f:
        json.dump(config_data, f)

    with pytest.raises(ValueError, match="Invalid sport config schema"):
        SportConfig(config_path)


def test_sport_category_matches():
    """Test SportCategory.matches() method."""
    config = load_sport_config()
    cycling = config.get_category("cycling")
    assert cycling is not None

    # Should match included types
    assert cycling.matches("Ride") is True
    assert cycling.matches("VirtualRide") is True

    # Should not match excluded types
    assert cycling.matches("EBikeRide") is False

    # Should not match unconfigured types
    assert cycling.matches("Run") is False


def test_categorize_unknown_returns_other_and_warns(caplog):
    """Unmapped sport_types fall into the 'other' bucket and emit a WARNING.

    The log-based metric in terraform/modules/desirelines/monitoring.tf is
    bound to the exact message string, so this test guards against silent
    drift between the code and the alert filter.
    """
    config = load_sport_config()
    # Use a stable but obviously bogus sport name. Reset the per-process
    # dedup so this test is order-independent.
    sport = "AbsolutelyMadeUpSport"
    config._unknown_seen.discard(sport)

    with caplog.at_level(logging.WARNING, logger="stravapipe.config.sport_config"):
        result = config.categorize_activity(sport)

    assert result == UNKNOWN_SPORT_CATEGORY
    matching = [r for r in caplog.records if r.message == UNKNOWN_SPORT_LOG_MESSAGE]
    assert len(matching) == 1, (
        f"expected one WARNING, got: {[r.message for r in caplog.records]}"
    )
    assert getattr(matching[0], "unmapped_sport_type", None) == sport
    assert getattr(matching[0], "fallback_category", None) == UNKNOWN_SPORT_CATEGORY


def test_categorize_unknown_dedupes_per_process(caplog):
    """Repeated unknown sport_types must not flood logs.

    Cloud Run instances handle bursts of webhooks; without dedup a single
    Strava-added sport could emit hundreds of identical WARNINGs. The alert
    only needs one to fire.
    """
    config = load_sport_config()
    sport = "DuplicatedUnknownSport"
    config._unknown_seen.discard(sport)

    with caplog.at_level(logging.WARNING, logger="stravapipe.config.sport_config"):
        config.categorize_activity(sport)
        config.categorize_activity(sport)
        config.categorize_activity(sport)

    matching = [r for r in caplog.records if r.message == UNKNOWN_SPORT_LOG_MESSAGE]
    assert len(matching) == 1, (
        f"expected one WARNING for repeated call, got {len(matching)}"
    )


def test_categorize_empty_returns_other_silently(caplog):
    """Empty input is bucketed to 'other' without emitting a WARNING."""
    config = load_sport_config()
    with caplog.at_level(logging.WARNING, logger="stravapipe.config.sport_config"):
        assert config.categorize_activity("") == UNKNOWN_SPORT_CATEGORY
    assert not [r for r in caplog.records if r.message == UNKNOWN_SPORT_LOG_MESSAGE], (
        "empty sport_type should not emit a WARNING"
    )


def test_other_category_in_config():
    """The 'other' category is a first-class category in sport_types.json."""
    config = load_sport_config()
    other = config.get_category("other")
    assert other is not None
    assert other.primary_metric == "time_minutes"
    assert other.has_distance is False
    assert other.has_elevation is False


def test_excluded_types_loaded():
    """Test that excluded_types are properly loaded from config.

    This verifies the excluded_types field is parsed correctly and used
    by the matches() method to filter out specific Strava types.
    """
    config = load_sport_config()

    # Cycling should have EBikeRide and EMountainBikeRide excluded
    cycling = config.get_category("cycling")
    assert cycling is not None
    assert "EBikeRide" in cycling.excluded_types
    assert "EMountainBikeRide" in cycling.excluded_types
    assert len(cycling.excluded_types) == 2

    # Running should have no excluded types
    running = config.get_category("running")
    assert running is not None
    assert len(running.excluded_types) == 0
