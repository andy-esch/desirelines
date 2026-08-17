# Standalone utility script (stdlib only, no third-party deps)
python_sources(
    name="scripts",
    sources=["schema_to_bq.py"],
)

python_tests(
    name="tests",
    sources=["test_schema_to_bq.py"],
    # load_table_schema reads ../<table>.json relative to the script, so the
    # sandbox needs the JSON resources alongside the module under test.
    dependencies=[":scripts", "schemas/bigquery:schemas"],
)
