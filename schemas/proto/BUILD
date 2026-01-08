# Protocol Buffer schemas for Desirelines
# Pants automatically generates Python and Go code from these

# Individual proto file targets for fine-grained dependency tracking
# apigateway protos (used by API Gateway Go module)
protobuf_sources(
    name="sports_metrics",
    sources=["desirelines/sports/v1/sports_metrics.proto"],
    python_resolve="stravapipe",
    go_mod_address="packages/apigateway:mod",
)

protobuf_sources(
    name="user_config",
    sources=["desirelines/config/v1/user_config.proto"],
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

# Aggregate target for apigateway Go protos (excludes webhook which uses dispatcher)
# Note: No python_resolve here - Python generation uses individual targets above
protobuf_sources(
    name="apigateway",
    sources=[
        "desirelines/sports/v1/sports_metrics.proto",
        "desirelines/config/v1/user_config.proto",
    ],
    go_mod_address="packages/apigateway:mod",
)

# Aggregate target for all protos - note: this won't work cleanly with Pants
# since different protos have different go_mod_address targets.
# Use specific targets (apigateway, webhook) instead.
