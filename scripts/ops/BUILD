shell_sources()

python_sources(
    name="ops0",
)

python_tests(
    name="tests",
    # test_check_strava_sports.py subprocess-invokes the sibling
    # check-strava-sports.py by path (hyphenated → not importable), so Pants
    # can't infer the dependency from imports. Declare it explicitly, or the
    # script is absent from the test sandbox and every case fails with
    # "can't open file 'scripts/ops/check-strava-sports.py'".
    # test_count_unstamped_goals.py loads count-unstamped-goals.py by path for the same reason.
    dependencies=[
        "scripts/ops/check-strava-sports.py:ops0",
        "scripts/ops/count-unstamped-goals.py:ops0",
    ],
)
