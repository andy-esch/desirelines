python_tests(
    resolve="stravapipe",
    tags=["integration"],
    overrides={
        "test_connection_resolution.py": {
            "dependencies": ["schemas/test-fixtures:activity_connection_fixture"],
        },
    },
)

python_test_utils(
    name="test_utils",
    resolve="stravapipe",
    dependencies=["packages/stravapipe:deps#google-cloud-firestore"],
)
