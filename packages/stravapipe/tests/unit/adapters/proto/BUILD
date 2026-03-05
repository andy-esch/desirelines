python_sources(resolve="stravapipe")

python_tests(
    name="tests",
    resolve="stravapipe",
    overrides={
        "test_webhook_adapter.py": {
            "dependencies": ["schemas/test-fixtures:webhook_fixtures"],
        },
    },
)
