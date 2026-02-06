from datetime import UTC, datetime
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from stravapipe.adapters.gcp._bigquery import ActivitiesReader, ActivitiesWriter
from stravapipe.domain import DetailedStravaActivity, SummaryStravaActivity
from stravapipe.exceptions import ActivityNotFoundError
from tests.unit.mocks.bigquery_client_wrapper import MockBigQueryClientWrapper


@pytest.fixture
def bq_client():
    return MockBigQueryClientWrapper(project_id="test-project")


@pytest.fixture
def activity2():
    fixture_path = (
        Path(__file__).parent.parent.parent.parent / "fixtures" / "activity_2.json"
    )
    with open(fixture_path, encoding="utf-8") as fin:
        activity = json.load(fin)
    return DetailedStravaActivity(**activity)


@pytest.fixture
def summary_activity():
    """Minimal SummaryStravaActivity for batch write tests."""
    return SummaryStravaActivity(
        id=99999,
        resource_state=2,
        external_id="test.fit",
        athlete={"id": 123, "resource_state": 1},
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
        map={"id": "a99999", "summary_polyline": "abc", "resource_state": 2},
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
    with open(schema_path, encoding="utf-8") as f:
        return json.load(f)["schema"]


@pytest.fixture
def write_activities_repo(bq_client):
    return ActivitiesWriter(bq_client, dataset_name="test-dataset")


@pytest.fixture
def read_activities_repo(bq_client):
    return ActivitiesReader(bq_client, dataset_name="test-dataset")


# =============================================================================
# ActivitiesWriter Tests
# =============================================================================


class TestActivitiesWriter:
    def test_write_activity_returns_stats(self, write_activities_repo, activity2):
        stats = write_activities_repo.write_activity(activity2)
        assert isinstance(stats, dict)
        assert "rows_affected" in stats
        assert "execution_time_ms" in stats

    def test_write_activity_staging_table_name(self, write_activities_repo, activity2):
        write_activities_repo.write_activity(activity2)
        # Should have written to staging table first
        assert write_activities_repo._client.table_name == "activities_staging"

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
        # Create a list that exceeds the 10,000 limit
        oversized = [activity2] * 10_001
        with pytest.raises(ValueError, match="exceeds BigQuery streaming insert"):
            write_activities_repo.write_activities_batch(oversized)

    def test_batch_with_detailed_activity(self, write_activities_repo, activity2):
        result = write_activities_repo.write_activities_batch([activity2])
        assert result["rows_affected"] == 1
        # Should have staging insert + MERGE + DELETE = 2 queries
        assert len(write_activities_repo._client.executed_queries) == 2
        # Written activities should use model_dump
        assert write_activities_repo._client.written_activities is not None
        assert len(write_activities_repo._client.written_activities) == 1
        assert write_activities_repo._client.written_activities[0]["id"] == activity2.id

    def test_batch_with_summary_activity_uses_to_bq_dict(
        self, write_activities_repo, summary_activity
    ):
        """SummaryActivity should use to_bq_dict() which excludes BQ-incompatible fields."""
        write_activities_repo.write_activities_batch([summary_activity])

        written = write_activities_repo._client.written_activities
        assert written is not None
        assert len(written) == 1

        # Fields excluded by to_bq_dict() should NOT be present
        assert "resource_state" not in written[0]
        assert "location_city" not in written[0]
        assert "location_state" not in written[0]
        assert "location_country" not in written[0]
        assert "from_accepted_tag" not in written[0]
        assert "utc_offset" not in written[0]

        # Core fields should still be present
        assert written[0]["id"] == summary_activity.id
        assert written[0]["name"] == "Test Run"

    def test_batch_merge_query_uses_array_param(
        self, write_activities_repo, activity2
    ):
        write_activities_repo.write_activities_batch([activity2])
        merge_query = write_activities_repo._client.executed_queries[0]
        assert "UNNEST(@activity_ids)" in merge_query


# =============================================================================
# ActivitiesReader Tests
# =============================================================================


class TestActivitiesReader:
    def test_read_activity_metadata_success(self, read_activities_repo):
        """Successful read returns MinimalStravaActivity."""
        read_activities_repo._client.query_results = [
            SimpleNamespace(
                id=12345,
                type="Run",
                start_date_local=datetime(2025, 6, 15, 10, 30, tzinfo=UTC),
                distance=5000.0,
                moving_time=1800,
                total_elevation_gain=50.0,
            )
        ]

        result = read_activities_repo.read_activity_metadata(12345)

        assert result.id == 12345
        assert result.type == "Run"
        assert result.distance == 5000.0
        assert result.moving_time == 1800
        assert result.total_elevation_gain == 50.0

    def test_read_activity_metadata_not_found(self, read_activities_repo):
        """Empty result raises ActivityNotFoundError."""
        # query_results defaults to [] in the mock
        with pytest.raises(ActivityNotFoundError):
            read_activities_repo.read_activity_metadata(99999)

    def test_query_checks_both_tables(self, read_activities_repo):
        """Query should UNION ALL across activities and deleted_activities."""
        with pytest.raises(ActivityNotFoundError):
            read_activities_repo.read_activity_metadata(12345)

        query = read_activities_repo._client.executed_queries[0]
        assert "UNION ALL" in query
        assert "test-dataset.activities" in query
        assert "test-dataset.deleted_activities" in query

    def test_query_uses_parameterized_id(self, read_activities_repo):
        """Query should use @activity_id parameter, not string interpolation."""
        with pytest.raises(ActivityNotFoundError):
            read_activities_repo.read_activity_metadata(12345)

        query = read_activities_repo._client.executed_queries[0]
        assert "@activity_id" in query

    def test_deleted_table_name_derived_from_table_name(self, bq_client):
        """deleted table name should be derived from configurable table_name."""
        reader = ActivitiesReader(
            bq_client, dataset_name="ds", table_name="custom_activities"
        )
        assert reader._deleted_table_name == "deleted_custom_activities"

    def test_default_table_names(self, read_activities_repo):
        """Default table name should be 'activities' with 'deleted_activities'."""
        assert read_activities_repo._table_name == "activities"
        assert read_activities_repo._deleted_table_name == "deleted_activities"
