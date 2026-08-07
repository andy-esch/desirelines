"""Unit tests for BQUserDeletionService."""

from unittest.mock import MagicMock

import pytest

from stravapipe.application.deletion import BQUserDeletionService
from stravapipe.exceptions import BigQueryError


@pytest.fixture
def mock_client():
    client = MagicMock()
    client.project_id = "test-project"
    return client


@pytest.fixture
def service(mock_client):
    return BQUserDeletionService(
        client=mock_client,
        dataset_id="test_dataset",
    )


class TestBQUserDeletionService:
    def test_deletes_from_every_table_holding_the_user(self, service, mock_client):
        """activities, its staging table, and the CDC table."""
        mock_client.execute_dml_query.side_effect = [5, 2, 5]

        result = service.run("12345", "corr-123", 1704067200)

        assert mock_client.execute_dml_query.call_count == 3
        assert result.activities_deleted == 5
        assert result.staging_deleted == 2
        assert result.live_deleted == 5

    def test_purges_activities_live(self, service, mock_client):
        """The CDC table must be covered — it is where activity data now lives."""
        mock_client.execute_dml_query.side_effect = [0, 0, 0]
        service.run("12345", "corr-123", 1704067200)

        queries = [c.args[0] for c in mock_client.execute_dml_query.call_args_list]
        assert any("activities_live" in q for q in queries)

    def test_retains_no_copy_of_the_deleted_data(self, service, mock_client):
        """No archive table: a copy of the rows would defeat the deletion."""
        mock_client.execute_dml_query.side_effect = [1, 1, 1]
        service.run("12345", "corr-123", 1704067200)

        queries = [c.args[0] for c in mock_client.execute_dml_query.call_args_list]
        assert not any("INSERT" in q.upper() for q in queries)
        assert not any("deleted_activities" in q for q in queries)

    def test_handles_no_data_to_delete(self, service, mock_client):
        mock_client.execute_dml_query.side_effect = [0, 0, 0]

        result = service.run("99999", "corr-456", 1704067200)

        assert result.activities_deleted == 0
        assert result.staging_deleted == 0
        assert result.live_deleted == 0

    def test_uses_parameterized_queries(self, service, mock_client):
        """The athlete id reaches BigQuery as a bound parameter, never inlined."""
        mock_client.execute_dml_query.side_effect = [0, 0, 0]

        service.run("12345", "corr-123", 1704067200)

        for call in mock_client.execute_dml_query.call_args_list:
            query, params = call.args
            assert [p.name for p in params] == ["user_id"]
            assert "12345" not in query

    def test_raises_on_bq_failure(self, service, mock_client):
        mock_client.execute_dml_query.side_effect = BigQueryError("BQ error")

        with pytest.raises(BigQueryError, match="BQ error"):
            service.run("12345", "corr-123", 1704067200)
