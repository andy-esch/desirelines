shell_sources()

files(
    name="deploy_web_fixture",
    sources=["deploy-web.sh"],
)

python_tests(
    name="tests",
    resolve="stravapipe",
    dependencies=[":deploy_web_fixture"],
)
