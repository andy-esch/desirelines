python_tests(
    name="tests",
    resolve="stravapipe",
    # Tests that load fixtures need explicit dependency
    # Pants can't infer Path(__file__).parent / "fixtures" / "file.json"
    overrides={
        # Domain tests load activity_1.json and activity_2.json
        "test_domain.py": {
            "dependencies": ["packages/stravapipe/tests/fixtures:test_fixtures"],
        }
    }
)
