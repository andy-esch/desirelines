# Protocol Buffer schemas for Desirelines
# Pants automatically generates Python and Go code from these

# Individual proto file targets for fine-grained dependency tracking
# apigateway protos (used by API Gateway Go module)
protobuf_sources(
    name="sports_metrics",
    sources=["desirelines/sports/v1/sports_metrics.proto"],
    go_mod_address="packages/apigateway:mod",
)

protobuf_sources(
    name="user_config",
    sources=["desirelines/config/v1/user_config.proto"],
    go_mod_address="packages/apigateway:mod",
)

# Activities protos (used by API Gateway for activity list/detail endpoints)
protobuf_sources(
    name="activities",
    sources=["desirelines/activities/v1/activities.proto"],
    go_mod_address="packages/apigateway:mod",
)

# Webhook proto (used by dispatcher Go module)
# Canonical definition for Strava webhook events shared between Go and Python
protobuf_sources(
    name="webhook",
    sources=["desirelines/webhook/v1/webhook.proto"],
    python_resolve="stravapipe",
    go_mod_address="packages/dispatcher:mod",
)

# BigQuery activities proto (Python only — used by stravapipe's BQ Storage
# Write API wrapper). GENERATED FILE — regenerate via `just generate-bq-proto`.
# See schemas/bigquery/generate_proto.py and the comment header in the
# generated .proto. CI's `verify-schemas` recipe diffs against the BQ JSON
# schema to catch drift.
protobuf_sources(
    name="bq_activities",
    sources=["desirelines/bigquery/v1/bq_activities.proto"],
    python_resolve="stravapipe",
    # Python is the only consumer, but `export-codegen` runs the Go backend for
    # every proto regardless. Without an address Pants cannot pick among the
    # repo's three go_mod targets and the whole goal fails, so name one; the
    # generated Go is never copied into the tree.
    go_mod_address="packages/dispatcher:mod",
)

# BigQuery activity ROW proto (Go only — used by the dispatcher to publish to
# the CDC topic under use_topic_schema). Same table schema as bq_activities
# above, but timestamps are RFC 3339 strings rather than micros, and it carries
# the CDC pseudocolumns. GENERATED FILE — regenerate via `just generate-bq-proto`.
#
# go_mod_address is required, not optional: the proto declares `option
# go_package`, and without an address Pants cannot tell which of the repo's
# several go_mod targets owns the generated Go, failing every broad goal.
protobuf_sources(
    name="bq_activity_rows",
    sources=["desirelines/bigquery/cdc/v1/bq_activity_rows.proto"],
    go_mod_address="packages/dispatcher:mod",
)

