# Protocol Buffer schemas for Desirelines
# Pants automatically generates Python and Go code from these

# Individual proto file targets for fine-grained dependency tracking
# All protos are used by apigateway Go module
protobuf_sources(
    name="sports_metrics",
    sources=["sports_metrics.proto"],
    python_resolve="stravapipe",
    go_mod_address="packages/apigateway:mod",
)

protobuf_sources(
    name="user_config",
    sources=["user_config.proto"],
    python_resolve="stravapipe",
    go_mod_address="packages/apigateway:mod",
)

# Aggregate target for convenience - depends on all protos
protobuf_sources(
    name="all",
    sources=["*.proto"],
    python_resolve="stravapipe",
    go_mod_address="packages/apigateway:mod",
)
