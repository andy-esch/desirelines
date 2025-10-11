import json
from pathlib import Path

import pytest

from stravapipe.adapters.gcp._bigquery import WriteActivitiesRepo
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
def write_activities_repo(bq_client):
    return WriteActivitiesRepo(bq_client, dataset_name="test-dataset")


class TestWriteActivitiesRepo:
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
