# Tell Pants to read dependencies from pyproject.toml
python_requirements(
    name="deps",
    source="pyproject.toml",
    resolve="stravapipe",
)

# Expose pyproject.toml as a file target for Docker builds
file(
    name="pyproject",
    source="pyproject.toml",
)

python_sources(
    name="lib",
    sources=["src/**/*.py"],
    resolve="stravapipe",
    # Overrides for specific files
    overrides={
        # sport_config.py needs JSON resource dependency
        # Pants can't auto-infer Path(__file__).parent / "file.json" dependencies
        "src/stravapipe/config/sport_config.py": {
            "dependencies": ["packages/stravapipe/src/stravapipe/config:sport_config_json"],
        },
        # Generated protobuf files - don't lint or type-check
        "src/stravapipe/types/generated/activities_pb2.py": {
            "skip_ruff": True,
            "skip_mypy": True,
        },
        "src/stravapipe/types/generated/sports_metrics_pb2.py": {
            "skip_ruff": True,
            "skip_mypy": True,
        },
    },
)
