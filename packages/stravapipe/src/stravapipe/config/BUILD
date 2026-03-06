# Configuration resources
# Include sport_types.json as a resource file so it's available at runtime
resources(
    name="sport_config_json",
    sources=["sport_types.json"],
)

python_sources(
    resolve="stravapipe",
    overrides={
        # sport_config.py loads sport_types.json via Path(__file__).parent
        # Pants can't auto-infer this runtime file dependency
        "sport_config.py": {
            "dependencies": [":sport_config_json"],
        },
    },
)
