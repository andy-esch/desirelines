# NOTE: Sources restricted from the default for python_sources due to conflict with
#   - packages/stravapipe/src/stravapipe/types/generated/__init__.py:../../../../lib
#   - packages/stravapipe/src/stravapipe/types/generated/sports_metrics_pb2.py:../../../../lib
#   - packages/stravapipe:lib
# The .py files are already covered by packages/stravapipe:lib (src/**/*.py)
# This target only includes .pyi stubs to avoid duplication
python_sources(
    name="generated",
    sources=[
        "sports_metrics_pb2.pyi",
    ],
    resolve="stravapipe",
    skip_ruff=True,  # Generated files, don't lint
    skip_mypy=True,  # Generated files, don't type-check
)
