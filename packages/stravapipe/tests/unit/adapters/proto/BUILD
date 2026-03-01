python_sources()

python_tests(
    name="tests",
    overrides={
        "test_webhook_adapter.py": {
            "dependencies": ["schemas/test-fixtures:webhook_fixtures"],
        },
    },
)
