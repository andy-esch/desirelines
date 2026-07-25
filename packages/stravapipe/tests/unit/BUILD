python_tests(
    name="tests",
    resolve="stravapipe",
    overrides={
        "test_activity_persistence_contract.py": {
            "dependencies": [
                "packages/stravapipe/tests/fixtures:test_fixtures",
                "schemas/activities:contract",
            ],
        },
    },
)
