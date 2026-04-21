python_sources(
    resolve="stravapipe",
    dependencies=[
        "packages/stravapipe:deps#psycopg",
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
)

python_test_utils(
    name="test_utils",
    resolve="stravapipe",
)
