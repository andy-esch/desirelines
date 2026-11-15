python_tests(
    name="tests",
    resolve="stravapipe",
    overrides={
        "test_deletion_service_app.py": {
            "dependencies": ["schemas/test-fixtures:deletion_ownership_fixture"],
        },
    },
)

python_test_utils(
    name="test_utils",
    resolve="stravapipe",
)
