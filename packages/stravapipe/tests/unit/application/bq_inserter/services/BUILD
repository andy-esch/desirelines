python_tests(
    name="tests",
    resolve="stravapipe",
    # Tests that load fixtures need explicit dependency
    # Pants can't infer Path(__file__).parent / "fixtures" / "file.json"
    overrides={
        # Sync service tests load JSON fixtures for activity processing
        "test_sync_service.py": {
            "dependencies": ["packages/stravapipe/tests/fixtures:test_fixtures"],
        }
    }
)
