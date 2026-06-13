"""Sport configuration loader with version and schema validation."""

from functools import lru_cache
import json
import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)

# Update when code supports new versions
SUPPORTED_CONFIG_VERSIONS = ["1.0"]

# UNKNOWN_SPORT_CATEGORY is the fallback bucket returned by
# SportConfig.categorize_activity for any Strava sport_type that has no
# explicit mapping in sport_types.json. Mirrors apigateway's
# config.UnknownSportCategory ("other"); changes must stay in lockstep.
UNKNOWN_SPORT_CATEGORY = "other"

# UNKNOWN_SPORT_LOG_MESSAGE is the canonical WARNING message the GCP
# log-based metric filter is bound to (see
# terraform/modules/desirelines/monitoring.tf). Renaming this string
# without also updating Terraform silently breaks the alert.
UNKNOWN_SPORT_LOG_MESSAGE = "Unknown Strava sport_type detected"


class DangerPaceModel(BaseModel):
    """Optional sustainable-pace limit; consumed by the web client only."""

    value_per_day: float = Field(alias="valuePerDay")
    unit: str

    model_config = {"populate_by_name": True}


# Pydantic models for schema validation
class SportCategoryModel(BaseModel):
    """Schema for sport category configuration."""

    display_name: str = Field(alias="displayName")
    # Strava sport_type values (NOT the broad 'type' field).
    # E.g., ["Yoga"] not ["Workout"]. See SportCategory docstring for details.
    strava_types: list[str] = Field(alias="stravaTypes", min_length=1)
    excluded_types: list[str] = Field(default=[], alias="excludedTypes")
    primary_metric: str = Field(alias="primaryMetric")
    metrics: list[str] = Field(min_length=1)
    has_distance: bool = Field(alias="hasDistance")
    has_elevation: bool = Field(alias="hasElevation")
    # Loaded and ignored by stravapipe; web frontend consumes it for danger-zone rendering.
    danger_pace: DangerPaceModel | None = Field(default=None, alias="dangerPace")

    model_config = {"populate_by_name": True}


class SportConfigModel(BaseModel):
    """Schema for sport configuration file."""

    version: str
    sport_categories: dict[str, SportCategoryModel] = Field(
        alias="sportCategories", min_length=1
    )

    model_config = {"populate_by_name": True}


class SportCategory:
    """Sport category configuration.

    Strava has two activity classification fields:
      - type: broad/deprecated category (e.g., "Workout" covers yoga, weights, HIIT)
      - sport_type: specific activity kind (e.g., "Yoga", "WeightTraining", "HIIT")

    strava_types contains sport_type values (the specific ones), NOT type values.
    The DB stores both: column 'type' = Strava type, column 'sport' = Strava sport_type.
    """

    def __init__(self, name: str, config: dict[str, Any]):
        self.name = name
        self.display_name = config["display_name"]
        self.strava_types = set(config["strava_types"])
        self.excluded_types = set(config.get("excluded_types", []))
        self.primary_metric = config["primary_metric"]
        self.metrics = config["metrics"]
        self.has_distance = config["has_distance"]
        self.has_elevation = config["has_elevation"]

    def matches(self, sport_type: str) -> bool:
        """Check if a Strava sport_type value belongs to this category."""
        return sport_type in self.strava_types and sport_type not in self.excluded_types


class SportConfig:
    """Sport configuration manager."""

    def __init__(self, config_path: Path, *, validate_version: bool = True):
        """Load and validate sport configuration.

        Args:
            config_path: Path to sport_types.json file.
            validate_version: If True, raise ValueError for unsupported versions.
                Set to False for testing version handling without triggering errors.
        """
        with config_path.open() as f:
            data = json.load(f)

        # Validate schema with Pydantic
        try:
            validated = SportConfigModel.model_validate(data)
        except ValidationError as e:
            raise ValueError(f"Invalid sport config schema:\n{e}") from e

        self.version = validated.version

        # Validate version (fail fast, consistent with Go implementation)
        if validate_version and self.version not in SUPPORTED_CONFIG_VERSIONS:
            raise ValueError(
                f"Unsupported sport config version: {self.version}\n"
                f"This code supports: {SUPPORTED_CONFIG_VERSIONS}\n"
                f"Update application code or rollback config version."
            )

        self.categories = {
            name: SportCategory(name, config.model_dump())
            for name, config in validated.sport_categories.items()
        }

        # Fail fast if a sport_type appears under more than one category. Python
        # would otherwise resolve a collision to the first match by document
        # order (silent), while the Go loader picks a per-restart-random winner;
        # either way it's a config bug, so reject it at load time in both.
        seen_strava_types: dict[str, str] = {}
        for name, category in self.categories.items():
            for strava_type in category.strava_types:
                existing = seen_strava_types.get(strava_type)
                if existing is not None:
                    raise ValueError(
                        f"Invalid sport config: sport_type {strava_type!r} maps to "
                        f"multiple categories ({existing!r} and {name!r}); each "
                        "sport_type must belong to exactly one category."
                    )
                seen_strava_types[strava_type] = name
        # Per-process dedup for the "Unknown Strava sport_type detected"
        # WARNING. Cloud Run recycles restore the alert's signal naturally —
        # one fresh sighting per restart is the desired behaviour.
        self._unknown_seen: set[str] = set()

    def categorize_activity(self, sport_type: str) -> str:
        """Map a Strava sport_type value to its sport category name.

        Returns the explicit category for known sport_types, or
        ``UNKNOWN_SPORT_CATEGORY`` ("other") as a fallback for any value not
        in ``sport_types.json``. Unknown values trigger a structured WARNING
        log on first sighting (deduplicated per process) that the GCP
        log-based metric pivots on for alerting.

        Args:
            sport_type: Strava ``sport_type`` value (e.g., ``"Ride"``, ``"Run"``).

        Returns:
            Category name (e.g., ``"cycling"``) or ``"other"`` for unmapped
            input. Empty/None-like input falls into ``"other"`` silently
            (no WARNING) to avoid alert noise from NULL columns.
        """
        for name, category in self.categories.items():
            if category.matches(sport_type):
                return name
        if not sport_type:
            return UNKNOWN_SPORT_CATEGORY
        if sport_type not in self._unknown_seen:
            self._unknown_seen.add(sport_type)
            logger.warning(
                UNKNOWN_SPORT_LOG_MESSAGE,
                extra={
                    "unmapped_sport_type": sport_type,
                    "fallback_category": UNKNOWN_SPORT_CATEGORY,
                },
            )
        return UNKNOWN_SPORT_CATEGORY

    def get_category(self, sport: str) -> SportCategory | None:
        """Get configuration for a sport category."""
        return self.categories.get(sport)

    def list_sports(self) -> list[str]:
        """Get list of all configured sport categories."""
        return list(self.categories.keys())


@lru_cache(maxsize=1)
def load_sport_config() -> SportConfig:
    """Load sport configuration (cached, validated).

    Returns:
        SportConfig instance with validated schema and version.

    Raises:
        FileNotFoundError: If sport_types.json is missing.
        ValueError: If schema is invalid or version is unsupported.
    """
    config_path = Path(__file__).parent / "sport_types.json"

    if not config_path.exists():
        raise FileNotFoundError(
            f"Sport config not found: {config_path}\nRun: make sync-sport-config"
        )

    # Version validation happens in SportConfig.__init__
    return SportConfig(config_path)
