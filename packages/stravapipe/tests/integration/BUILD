python_sources(
    resolve="stravapipe",
    dependencies=[
        "packages/stravapipe:deps#psycopg",
        "schemas/database:migrations",
        "schemas/database:callbacks",
    ],
)

python_tests(
    name="tests",
    resolve="stravapipe",
    # Integration tests require running PostgreSQL
    tags=["integration"],
    dependencies=[
        "packages/stravapipe:deps#psycopg",
    ],
    overrides={
        "test_activity_id_cleanup.py": {
            "dependencies": ["schemas/database:local_seeds"],
        },
    },
)

python_test_utils(
    name="test_utils",
    resolve="stravapipe",
)
