python_tests(
    name="tests",
    resolve="stravapipe",
    overrides={
        "test_activity_connection.py": {
            "dependencies": ["schemas/test-fixtures:activity_connection_fixture"],
        },
        "test_token_store_parity.py": {
            "dependencies": ["schemas/test-fixtures:strava_tokens_fixtures"],
        },
    },
)
