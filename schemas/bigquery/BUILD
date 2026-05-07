# BigQuery table schema definitions.
#
# `activities_full.json` is the source of truth for the activities
# table's column structure. Consumed by:
#   - terraform/modules/desirelines/main.tf (table creation)
#   - tests in packages/stravapipe/tests/unit/adapters/gcp that
#     verify schema parity / round-trip serialization

resources(
    name="schemas",
    sources=["*.json"],
)
