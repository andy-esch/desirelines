import json
from pathlib import Path

import pytest

from stravapipe.adapters.gcp._bigquery import ActivitiesRepo
from stravapipe.domain import DetailedStravaActivity
from tests.mocks.bigquery_client_wrapper import MockBigQueryClientWrapper


@pytest.fixture
def bq_client():
    return MockBigQueryClientWrapper(project_id="test-project")


@pytest.fixture
def activity2():
    fixture_path = Path(__file__).parent.parent.parent / "fixtures" / "activity_2.json"
    with open(fixture_path, encoding="utf-8") as fin:
        activity = json.load(fin)
    return DetailedStravaActivity(**activity)


@pytest.fixture
def bigquery_schema():
    """Load the BigQuery schema from test fixtures.

    This is a copy of schemas/bigquery/activities_full.json kept in the package
    for self-contained testing. If the BigQuery schema changes, update this fixture file.
    """
    schema_path = (
        Path(__file__).parent.parent.parent
        / "fixtures"
        / "bigquery_activities_schema.json"
    )
    with open(schema_path, encoding="utf-8") as f:
        return json.load(f)["schema"]


@pytest.fixture
def write_activities_repo(bq_client):
    return ActivitiesRepo(bq_client, dataset_name="test-dataset")


class TestActivitiesRepo:
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
        # Should have executed a MERGE query
        assert len(write_activities_repo._client.executed_queries) == 1
        query = write_activities_repo._client.executed_queries[0]
        assert "MERGE" in query.upper()
        assert "activities_staging" in query
        assert "ROW_NUMBER()" in query
        assert str(activity2.id) in query  # Should include the activity ID

    def test_activity_model_matches_bigquery_schema(self, activity2, bigquery_schema):
        """Test that serialized DetailedStravaActivity exactly matches BigQuery schema.

        This ensures that model_dump() produces only fields that exist in the
        BigQuery table schema, preventing 'no such field' errors during insertion.
        """

        def extract_field_names(schema, prefix=""):
            """Recursively extract all field names from BigQuery schema, including nested RECORD fields."""
            fields = set()
            for field_def in schema:
                field_name = field_def["name"]
                full_name = f"{prefix}{field_name}" if prefix else field_name
                fields.add(full_name)

                # Handle nested RECORD types (like 'athlete', 'map', 'gear', etc.)
                if field_def["type"] == "RECORD" and "fields" in field_def:
                    nested_fields = extract_field_names(
                        field_def["fields"], prefix=f"{full_name}."
                    )
                    fields.update(nested_fields)

            return fields

        # Get all valid BigQuery field names (including nested)
        bq_fields = extract_field_names(bigquery_schema)

        # Serialize the activity model
        dumped_activity = activity2.model_dump(mode="json")

        def extract_model_fields(data, prefix=""):
            """Recursively extract all field names from dumped model."""
            fields = set()
            for key, value in data.items():
                full_key = f"{prefix}{key}" if prefix else key
                fields.add(full_key)

                # Handle nested dicts (matches BigQuery RECORD types)
                if isinstance(value, dict):
                    nested = extract_model_fields(value, prefix=f"{full_key}.")
                    fields.update(nested)

            return fields

        # Get all fields from the serialized model
        model_fields = extract_model_fields(dumped_activity)

        # Find fields in model that aren't in BigQuery schema
        extra_fields = model_fields - bq_fields

        # Find required BigQuery fields missing from model (ignore nullable fields)
        required_bq_fields = {
            field["name"]
            for field in bigquery_schema
            if field.get("mode") == "REQUIRED"
        }
        missing_fields = required_bq_fields - model_fields

        # Assert no extra fields (these would cause insertion errors)
        assert not extra_fields, (
            f"Model has fields not in BigQuery schema (would cause 'no such field' errors): {extra_fields}"
        )

        # Assert all required fields present
        assert not missing_fields, (
            f"Model missing required BigQuery fields: {missing_fields}"
        )
