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

