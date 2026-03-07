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
    def test_archives_then_deletes_from_all_tables(self, service, mock_client):
        """Archives activities for audit trail, then deletes from active tables."""
        mock_client.execute_dml_query.side_effect = [5, 5, 2]

        result = service.run("12345", "corr-123", 1704067200)

        # 3 DML calls: archive, delete activities, delete staging
        assert mock_client.execute_dml_query.call_count == 3
        assert result.activities_archived == 5
        assert result.activities_deleted == 5
        assert result.staging_deleted == 2

    def test_handles_no_data_to_delete(self, service, mock_client):
        mock_client.execute_dml_query.side_effect = [0, 0, 0]

        result = service.run("99999", "corr-456", 1704067200)

        assert result.activities_archived == 0
        assert result.activities_deleted == 0
        assert result.staging_deleted == 0

    def test_uses_parameterized_queries(self, service, mock_client):
        mock_client.execute_dml_query.side_effect = [0, 0, 0]

        service.run("12345", "corr-123", 1704067200)

        # Each call gets a query and parameters
        for call in mock_client.execute_dml_query.call_args_list:
            _query, params = call.args
            assert params is not None
            assert len(params) > 0

        # Archive query (first call) includes event_time and correlation_id params
        _, archive_params = mock_client.execute_dml_query.call_args_list[0].args
        param_names = [p.name for p in archive_params]
        assert "user_id" in param_names
        assert "event_time" in param_names
        assert "correlation_id" in param_names

        # Delete queries (calls 2-3) only have user_id param
        for call in mock_client.execute_dml_query.call_args_list[1:]:
            _, params = call.args
            param_names = [p.name for p in params]
            assert param_names == ["user_id"]

    def test_raises_on_bq_failure(self, service, mock_client):
        mock_client.execute_dml_query.side_effect = BigQueryError("BQ error")

        with pytest.raises(BigQueryError, match="BQ error"):
            service.run("12345", "corr-123", 1704067200)
