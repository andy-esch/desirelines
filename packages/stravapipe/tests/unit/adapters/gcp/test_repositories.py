from datetime import UTC, datetime
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from stravapipe.adapters.gcp._bigquery import ActivitiesWriter
from stravapipe.domain import (
    DetailedStravaActivity,
    MetaAthlete,
    SummaryMap,
    SummaryStravaActivity,
)
from tests.unit.mocks.bigquery_client_wrapper import MockBigQueryClientWrapper


@pytest.fixture
def bq_client():
    return MockBigQueryClientWrapper(project_id="test-project")


@pytest.fixture
def activity2():
    fixture_path = (
        Path(__file__).parent.parent.parent.parent / "fixtures" / "activity_2.json"
    )
    with fixture_path.open(encoding="utf-8") as fin:
        activity = json.load(fin)
    return DetailedStravaActivity(**activity)


@pytest.fixture
def summary_activity():
    """Minimal SummaryStravaActivity for batch write tests."""
    return SummaryStravaActivity(
        id=99999,
        resource_state=2,
        external_id="test.fit",
        athlete=MetaAthlete(id=123, resource_state=1),
        name="Test Run",
        type="Run",
        sport_type="Run",
        distance=5000.0,
        moving_time=1800,
        elapsed_time=2000,
        total_elevation_gain=50.0,
        start_date=datetime(2025, 1, 15, 10, 0, tzinfo=UTC),
        start_date_local=datetime(2025, 1, 15, 11, 0, tzinfo=UTC),
        timezone="(GMT+01:00) Europe/Berlin",
        utc_offset=3600.0,
        start_latlng=[52.52, 13.40],
        end_latlng=[52.53, 13.41],
        location_city="Berlin",
        achievement_count=0,
        kudos_count=0,
        comment_count=0,
        athlete_count=1,
        photo_count=0,
        has_kudoed=False,
        map=SummaryMap(id="a99999", summary_polyline="abc", resource_state=2),
        trainer=False,
        commute=False,
        manual=False,
        private=False,
        flagged=False,
        from_accepted_tag=False,
        average_speed=2.78,
        max_speed=3.5,
    )


@pytest.fixture
def bigquery_schema():
    """Load the BigQuery schema from test fixtures."""
    schema_path = (
        Path(__file__).parent.parent.parent.parent
        / "fixtures"
        / "bigquery_activities_schema.json"
    )
    with schema_path.open(encoding="utf-8") as f:
        return json.load(f)["schema"]


@pytest.fixture
def write_activities_repo(bq_client):
    # Both the single-write and batch paths now go through the injected
    # BigQueryStorageWriter. Tests use a MagicMock — the real one opens
    # a gRPC channel at construction. Behavior of the writer itself is
    # covered in test_bigquery_storage.py; these tests assert that
    # ActivitiesWriter calls into it correctly.
    storage_writer = MagicMock()
    return ActivitiesWriter(
        bq_client,
        storage_writer=storage_writer,
        dataset_name="test-dataset",
    )


# =============================================================================
# ActivitiesWriter Tests
# =============================================================================


class TestActivitiesWriter:
    def test_write_activity_returns_stats(self, write_activities_repo, activity2):
        stats = write_activities_repo.write_activity(activity2)
        assert isinstance(stats, dict)
        assert "rows_affected" in stats
        assert "execution_time_ms" in stats

    def test_write_activity_calls_storage_writer(
        self, write_activities_repo, activity2
    ):
        # The single-activity staging write goes through the injected
        # BigQueryStorageWriter (Storage Write API). Verify the writer
        # was called exactly once with the activity. The
        # `activities_staging` table name is enforced at the factory
        # (`make_write_activities`), not in this class — see
        # `__init__.py` and the parity test in `test_bigquery_storage.py`.
        write_activities_repo.write_activity(activity2)
        write_activities_repo._storage_writer.write_activity.assert_called_once_with(
            activity2
        )

    def test_write_activity_merge_query_executed(
        self, write_activities_repo, activity2
    ):
        write_activities_repo.write_activity(activity2)
        # Should have executed a MERGE query followed by a DELETE cleanup query
        assert len(write_activities_repo._client.executed_queries) == 2
        merge_query = write_activities_repo._client.executed_queries[0]
        assert "MERGE" in merge_query.upper()
        assert "activities_staging" in merge_query
        assert "ROW_NUMBER()" in merge_query
        assert "@activity_id" in merge_query  # Should use parameterized query

        delete_query = write_activities_repo._client.executed_queries[1]
        assert "DELETE" in delete_query.upper()
        assert "activities_staging" in delete_query

    def test_activity_model_matches_bigquery_schema(self, activity2, bigquery_schema):
        """Test that serialized DetailedStravaActivity exactly matches BigQuery schema."""

        def extract_field_names(schema, prefix=""):
            fields = set()
            for field_def in schema:
                field_name = field_def["name"]
                full_name = f"{prefix}{field_name}" if prefix else field_name
                fields.add(full_name)
                if field_def["type"] == "RECORD" and "fields" in field_def:
                    nested_fields = extract_field_names(
                        field_def["fields"], prefix=f"{full_name}."
                    )
                    fields.update(nested_fields)
            return fields

        bq_fields = extract_field_names(bigquery_schema)
        dumped_activity = activity2.model_dump(mode="json")

        def extract_model_fields(data, prefix=""):
            fields = set()
            for key, value in data.items():
                full_key = f"{prefix}{key}" if prefix else key
                fields.add(full_key)
                if isinstance(value, dict):
                    nested = extract_model_fields(value, prefix=f"{full_key}.")
                    fields.update(nested)
            return fields

        model_fields = extract_model_fields(dumped_activity)
        extra_fields = model_fields - bq_fields
        required_bq_fields = {
            field["name"]
            for field in bigquery_schema
            if field.get("mode") == "REQUIRED"
        }
        missing_fields = required_bq_fields - model_fields

        assert not extra_fields, (
            f"Model has fields not in BigQuery schema: {extra_fields}"
        )
        assert not missing_fields, (
            f"Model missing required BigQuery fields: {missing_fields}"
        )


class TestActivitiesWriterBatch:
    def test_empty_batch_returns_zero(self, write_activities_repo):
        result = write_activities_repo.write_activities_batch([])
        assert result["rows_affected"] == 0
        assert result["execution_time_ms"] == 0
        assert result["job_id"] == ""

    def test_exceeds_batch_limit_raises_value_error(
        self, write_activities_repo, activity2
    ):
        # Application-level sanity cap, not a BQ limit — see _MAX_BATCH_SIZE
        oversized = [activity2] * 10_001
        with pytest.raises(ValueError, match="exceeds the sanity cap"):
            write_activities_repo.write_activities_batch(oversized)

    def test_batch_with_detailed_activity(self, write_activities_repo, activity2):
        result = write_activities_repo.write_activities_batch([activity2])
        assert result["rows_affected"] == 1
        # Staging write now goes through the Storage Write API wrapper,
        # so the only DML the mock client sees is MERGE + DELETE.
        assert len(write_activities_repo._client.executed_queries) == 2
        write_activities_repo._storage_writer.write_activities_batch.assert_called_once_with(
            [activity2]
        )

    def test_batch_passes_summary_activity_to_storage_writer(
        self, write_activities_repo, summary_activity
    ):
        """SummaryActivity flows through to the storage writer unchanged.

        The dump-for-BQ shaping (``to_bq_dict()`` field exclusion) lives
        inside ``BigQueryStorageWriter._dump_for_bq`` — see
        ``test_bigquery_storage.py`` for the field-level assertions.
        """
        write_activities_repo.write_activities_batch([summary_activity])
        write_activities_repo._storage_writer.write_activities_batch.assert_called_once_with(
            [summary_activity]
        )

    def test_batch_merge_query_uses_array_param(self, write_activities_repo, activity2):
        write_activities_repo.write_activities_batch([activity2])
        merge_query = write_activities_repo._client.executed_queries[0]
        assert "UNNEST(@activity_ids)" in merge_query
