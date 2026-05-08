python_tests(
    name="tests",
    resolve="stravapipe",
    # Tests that load fixtures need explicit dependency
    # Pants can't infer Path(__file__).parent / "fixtures" / "file.json"
    overrides={
        # GCP adapter tests load JSON fixtures for repository testing
        "test_repositories.py": {
            "dependencies": ["packages/stravapipe/tests/fixtures:test_fixtures"],
        },
        # Storage Write API spike test loads activity_1.json for the
        # serialization round-trip case.
        "test_bigquery_storage.py": {
            "dependencies": ["packages/stravapipe/tests/fixtures:test_fixtures"],
        },
        # Production wrapper test loads BOTH the activity fixtures AND
        # the canonical BQ schema JSON (for schema-parity assertions).
        # The canonical schema lives outside the package so it's
        # referenced via the schemas/bigquery target.
        "test_bigquery_storage.py": {
            "dependencies": [
                "packages/stravapipe/tests/fixtures:test_fixtures",
                "schemas/bigquery:schemas",
            ],
        },
    }
)
