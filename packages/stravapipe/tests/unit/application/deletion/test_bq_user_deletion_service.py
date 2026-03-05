"""Unit tests for BQUserDeletionService."""

from unittest.mock import MagicMock

import pytest

from stravapipe.application.deletion import BQUserDeletionService


@pytest.fixture
def mock_bq_client():
    return MagicMock()


@pytest.fixture
def service(mock_bq_client):
    return BQUserDeletionService(
        bq_client=mock_bq_client,
        project_id="test-project",
        dataset_id="test_dataset",
    )


def _mock_query_result(bq_client, affected_rows_sequence):
    """Configure mock BQ client to return a sequence of affected row counts."""
    jobs = []
    for count in affected_rows_sequence:
        job = MagicMock()
        job.result.return_value = None
        job.num_dml_affected_rows = count
        jobs.append(job)
    bq_client.query.side_effect = jobs


class TestBQUserDeletionService:
    def test_archives_then_deletes_from_all_tables(self, service, mock_bq_client):
        """Archives activities for audit trail, then deletes from active tables."""
        _mock_query_result(mock_bq_client, [5, 5, 2])

        result = service.run("12345", "corr-123", 1704067200)

        # 3 queries: archive, delete activities, delete staging
        assert mock_bq_client.query.call_count == 3
        assert result.activities_archived == 5
        assert result.activities_deleted == 5
        assert result.staging_deleted == 2

    def test_handles_no_data_to_delete(self, service, mock_bq_client):
        _mock_query_result(mock_bq_client, [0, 0, 0])

        result = service.run("99999", "corr-456", 1704067200)

        assert result.activities_archived == 0
        assert result.activities_deleted == 0
        assert result.staging_deleted == 0

    def test_uses_parameterized_queries(self, service, mock_bq_client):
        _mock_query_result(mock_bq_client, [0, 0, 0])

        service.run("12345", "corr-123", 1704067200)

        # Each query gets its own job_config
        for c in mock_bq_client.query.call_args_list:
            job_config = c.kwargs.get("job_config") or c.args[1]
            assert job_config is not None

        # Archive query (first call) includes event_time and correlation_id params
        archive_config = mock_bq_client.query.call_args_list[0].kwargs["job_config"]
        param_names = [p.name for p in archive_config.query_parameters]
        assert "user_id" in param_names
        assert "event_time" in param_names
        assert "correlation_id" in param_names

        # Delete queries (calls 2-3) only have user_id param
        for c in mock_bq_client.query.call_args_list[1:]:
            config = c.kwargs["job_config"]
            param_names = [p.name for p in config.query_parameters]
            assert param_names == ["user_id"]

    def test_raises_on_bq_failure(self, service, mock_bq_client):
        job = MagicMock()
        job.result.side_effect = Exception("BQ error")
        mock_bq_client.query.return_value = job

        with pytest.raises(Exception, match="BQ error"):
            service.run("12345", "corr-123", 1704067200)
