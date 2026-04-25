"""Sport configuration loader with version and schema validation."""

from functools import lru_cache
import json
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError

# Update when code supports new versions
SUPPORTED_CONFIG_VERSIONS = ["1.0"]


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

    def __init__(self, name: str, config: dict):
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

    def categorize_activity(self, sport_type: str) -> str | None:
        """Map a Strava sport_type value to its sport category name."""
        for name, category in self.categories.items():
            if category.matches(sport_type):
                return name
        return None

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
