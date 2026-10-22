python_sources(
    overrides={
        "activity_table_lifecycle.py": {"dependencies": [":table-lifecycle-fixture"]},
    },
)

resources(
    name="table-lifecycle-fixture",
    sources=["fixtures/activity_table_lifecycle.tf.tftpl"],
)

resources(
    name="inputs",
    sources=["image-build-inputs.json"],
)

# Already present in the stravapipe lockfile; used only to inspect workflow
# contracts in tests, never required by the release script on hosted runners.
python_requirement(
    name="yaml",
    requirements=["PyYAML>=6.0.3"],
    resolve="stravapipe",
)

python_tests(
    name="tests",
    dependencies=[":inputs", ":yaml", "//.github/workflows:release"],
)
