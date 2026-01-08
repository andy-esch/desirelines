# NOTE: Sources restricted from the default for python_sources due to conflict with
#   - packages/stravapipe/src/stravapipe/types/generated/__init__.py:../../../../lib
#   - packages/stravapipe/src/stravapipe/types/generated/sports_metrics_pb2.py:../../../../lib
#   - packages/stravapipe:lib
# The .py files are already covered by packages/stravapipe:lib (src/**/*.py)
# This target only includes .pyi stubs to avoid duplication
python_sources(
    name="sports_metrics",
    sources=[
        "sports_metrics_pb2.pyi",
    ],
    resolve="stravapipe",
    skip_ruff=True,  # Generated files, don't lint
    skip_mypy=True,  # Generated files, don't type-check
)

# NOTE: Sources restricted from the default for python_sources due to conflict with
#   - packages/stravapipe/src/stravapipe/types/generated/__init__.py:../../../../docker_sources
#   - packages/stravapipe/src/stravapipe/types/generated/__init__.py:../../../../lib
#   - packages/stravapipe/src/stravapipe/types/generated/sports_metrics_pb2.py:../../../../docker_sources
#   - packages/stravapipe/src/stravapipe/types/generated/sports_metrics_pb2.py:../../../../lib
#   - packages/stravapipe/src/stravapipe/types/generated/sports_metrics_pb2.pyi
#   - packages/stravapipe/src/stravapipe/types/generated/webhook_pb2.py:../../../../docker_sources
#   - packages/stravapipe/src/stravapipe/types/generated/webhook_pb2.py:../../../../lib
#   - packages/stravapipe/src/stravapipe/types/generated:generated
#   - packages/stravapipe:docker_sources
#   - packages/stravapipe:lib
python_sources(
    name="strava_webhook",
    sources=[
        "webhook_pb2.pyi",
    ],
    resolve="stravapipe",
    skip_ruff=True,  # Generated files, don't lint
    skip_mypy=True,  # Generated files, don't type-check
)

# NOTE: Sources restricted from the default for python_sources due to conflict with
#   - packages/stravapipe/src/stravapipe/types/generated/__init__.py:../../../../docker_sources
#   - packages/stravapipe/src/stravapipe/types/generated/__init__.py:../../../../lib
#   - packages/stravapipe/src/stravapipe/types/generated/sports_metrics_pb2.py:../../../../docker_sources
#   - packages/stravapipe/src/stravapipe/types/generated/sports_metrics_pb2.py:../../../../lib
#   - packages/stravapipe/src/stravapipe/types/generated/sports_metrics_pb2.pyi:sports_metrics
#   - packages/stravapipe/src/stravapipe/types/generated/user_config_pb2.py:../../../../docker_sources
#   - packages/stravapipe/src/stravapipe/types/generated/user_config_pb2.py:../../../../lib
#   - packages/stravapipe/src/stravapipe/types/generated/webhook_pb2.py:../../../../docker_sources
#   - packages/stravapipe/src/stravapipe/types/generated/webhook_pb2.py:../../../../lib
#   - packages/stravapipe/src/stravapipe/types/generated/webhook_pb2.pyi:strava_webhook
#   - packages/stravapipe/src/stravapipe/types/generated:sports_metrics
#   - packages/stravapipe/src/stravapipe/types/generated:strava_webhook
#   - packages/stravapipe:docker_sources
#   - packages/stravapipe:lib
python_sources(
    sources=[
        "user_config_pb2.pyi",
    ],
    skip_ruff=True,  # Generated files, don't lint
    skip_mypy=True,  # Generated files, don't type-check
)
