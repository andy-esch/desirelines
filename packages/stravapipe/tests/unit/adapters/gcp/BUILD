python_tests(
    name="tests",
    resolve="stravapipe",
    # Tests that load fixtures need explicit dependency
    # Pants can't infer Path(__file__).parent / "fixtures" / "file.json"
    overrides={
        # GCP adapter tests load JSON fixtures for repository testing
        "test_repositories.py": {
            "dependencies": ["packages/stravapipe/tests/fixtures:test_fixtures"],
        }
    }
)
