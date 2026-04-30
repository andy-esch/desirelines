# 3. Add HTTP integration tests + a Strava API contract test

**Severity:** High — closes the biggest test-coverage gap.

## What's there today

- 316 lines of unit tests for `retry.py`, plus PG repository integration
  tests using testcontainers (`tests/integration/test_postgres_repository.py`).
- `tests/unit/cloudrun/test_bq_inserter_app.py`,
  `test_postgres_writer_app.py`, `test_deletion_service_app.py`, and
  `test_webhook_handler.py` exist — but a quick scan shows they primarily
  test internal helpers, not the full HTTP path with `TestClient`.
- **No test against Strava's actual response shapes.** All Strava
  interactions are mocked at the port boundary
  (`tests/unit/mocks/read_strava_token.py`), so a Strava API field rename or
  removal slips through.
- **No protobuf round-trip test** for `dict_to_webhook_event` against real
  webhook payloads.
- **No BigQuery schema-drift test** — if a column is added to
  `_MERGE_COLUMNS` but not the BQ table, you find out in production.

## Recommendations

1. **End-to-end FastAPI tests with `TestClient`.** For each app, build a
   CloudEvent fixture (real captured Pub/Sub envelope JSON), POST it to
   `/`, assert response shape, and verify the right adapter methods were
   called with the right payload. FastAPI's TestClient supports the
   lifespan handler. Use dependency override for adapters.
2. **Contract test for Strava responses.** Capture a recent JSON response
   from `https://www.strava.com/api/v3/athlete/activities` (sanitize PII)
   into `tests/fixtures/strava/`. Add a test that loads each fixture and
   validates `DetailedStravaActivity.model_validate(payload)` succeeds.
   This catches schema drift on every CI run. Pact-style consumer-driven
   contract testing is overkill here; fixture-replay is the right
   granularity.
3. **BigQuery schema validation test (integration).** Spin up the BigQuery
   emulator (`ghcr.io/goccy/bigquery-emulator`) or use real BQ in a CI
   dataset; create the table from your DDL, run `_build_merge_query_base()`
   against it with a synthetic activity, and assert success. This catches
   `_MERGE_COLUMNS` / schema mismatches at PR time.
4. **Protobuf round-trip test.** A canned webhook JSON →
   `dict_to_webhook_event` → assert all fields. Cheap insurance for
   proto-schema drift.
5. **Mutation-test the retry logic.** `retry.py` is critical and
   well-tested; running mutmut or cosmic-ray on it once would surface any
   blind spots.

## References

- FastAPI testing: <https://fastapi.tiangolo.com/tutorial/testing/>
- FastAPI lifespan in tests:
  <https://fastapi.tiangolo.com/advanced/testing-events/>
- Testcontainers Python (already used):
  <https://testcontainers-python.readthedocs.io/>
- BigQuery emulator: <https://github.com/goccy/bigquery-emulator>
- mutmut: <https://mutmut.readthedocs.io/>
- "Contract testing fundamentals":
  <https://martinfowler.com/bliki/ContractTest.html>
