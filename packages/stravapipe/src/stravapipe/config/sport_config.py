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

    display_name: str
    strava_types: list[str] = Field(min_length=1)
    excluded_types: list[str] = []
    primary_metric: str
    metrics: list[str] = Field(min_length=1)
    has_distance: bool
    has_elevation: bool


class SportConfigModel(BaseModel):
    """Schema for sport configuration file."""

    version: str
    sport_categories: dict[str, SportCategoryModel] = Field(min_length=1)


class SportCategory:
    """Sport category configuration."""

    def __init__(self, name: str, config: dict):
        self.name = name
        self.display_name = config["display_name"]
        self.strava_types = set(config["strava_types"])
        self.excluded_types = set(config.get("excluded_types", []))
        self.primary_metric = config["primary_metric"]
        self.metrics = config["metrics"]
        self.has_distance = config["has_distance"]
        self.has_elevation = config["has_elevation"]

    def matches(self, strava_type: str) -> bool:
        """Check if Strava activity type belongs to this sport."""
        return (
            strava_type in self.strava_types and strava_type not in self.excluded_types
        )


class SportConfig:
    """Sport configuration manager."""

    def __init__(self, config_path: Path):
        with open(config_path) as f:
            data = json.load(f)

        # Validate schema with Pydantic
        try:
            validated = SportConfigModel.model_validate(data)
        except ValidationError as e:
            raise ValueError(f"Invalid sport config schema:\n{e}") from e

        self.version = validated.version
        self.categories = {
            name: SportCategory(name, config.model_dump())
            for name, config in validated.sport_categories.items()
        }

    def categorize_activity(self, strava_type: str) -> str | None:
        """Map Strava activity type to sport category."""
        for name, category in self.categories.items():
            if category.matches(strava_type):
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
    """Load sport configuration (cached, validated)."""
    config_path = Path(__file__).parent / "sport_types.json"

    if not config_path.exists():
        raise FileNotFoundError(
            f"Sport config not found: {config_path}\nRun: make sync-sport-config"
        )

    config = SportConfig(config_path)

    # Validate version (fail fast)
    if config.version not in SUPPORTED_CONFIG_VERSIONS:
        raise ValueError(
            f"Unsupported sport config version: {config.version}\n"
            f"This code supports: {SUPPORTED_CONFIG_VERSIONS}\n"
            f"Update application code or rollback config version."
        )

    return config
