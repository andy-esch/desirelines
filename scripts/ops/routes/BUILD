python_sources(name="routes")

python_tests(
    name="tests",
    # The test loads compare_route_sources.py by path (like the sibling ops-script
    # tests), so Pants can't infer the dependency from an import. Declare it, or
    # the script is absent from the test sandbox.
    dependencies=["scripts/ops/routes/compare_route_sources.py:routes"],
)
