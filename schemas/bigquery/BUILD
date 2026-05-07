# BigQuery table schema definitions.
#
# `activities_full.json` is the source of truth for the activities
# table's column structure. Consumed by:
#   - terraform/modules/desirelines/main.tf (table creation)
#   - schemas/bigquery/generate_proto.py (BQ → proto codegen)
#   - tests in packages/stravapipe/tests/unit/adapters/gcp that
#     verify schema parity / round-trip serialization
#
# `generate_proto.py` is the converter that produces
# schemas/proto/desirelines/bigquery/v1/bq_activities.proto. Run via
# `just generate-bq-proto`. Verified in CI by `just verify-schemas`,
# which calls `generate_proto.py --check`.

resources(
    name="schemas",
    sources=["*.json"],
)

# The generator is pure stdlib Python — no third-party deps. Lives in
# the stravapipe resolve so its tests can run alongside the package's
# unit suite via `pants test ::`.
python_sources(
    name="generator",
    sources=["generate_proto.py"],
    resolve="stravapipe",
)

python_tests(
    name="tests",
    sources=["test_generate_proto.py"],
    resolve="stravapipe",
    # generate_proto's smoke test reads activities_full.json via the
    # repo-relative REPO_ROOT path. Pants needs to know the test depends
    # on both the generator module and the JSON resource so the sandbox
    # has both files.
    dependencies=[":generator", ":schemas"],
)
