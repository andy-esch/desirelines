# Resource file needed for go:embed directive (baked into binary at compile time)
resources(
    name="embedded_files",
    sources=["sport_types.json"],
)

# File target for test runtime access (available in test working directory)
file(
    name="sport_types_json_file",
    source="sport_types.json",
)

go_package(
    dependencies=[
        ":embedded_files",  # For go:embed compilation
        ":sport_types_json_file",  # For test runtime file access
    ],
)
