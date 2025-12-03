python_test_utils(
    name="test_utils",
    resolve="stravapipe",
    dependencies=[
      # conftest.py imports from stravapipe.config, need explicit dependency
      "packages/stravapipe:lib",
    ]
)

python_tests(
    resolve="stravapipe",
)
