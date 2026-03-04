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
    def test_deletes_from_all_tables(self, service, mock_bq_client):
        _mock_query_result(mock_bq_client, [5, 5, 2, 7])

        result = service.run("12345", "corr-123")

        assert mock_bq_client.query.call_count == 4
        assert result.activities_archived == 5
        assert result.activities_deleted == 5
        assert result.staging_deleted == 2
        assert result.archive_deleted == 7

    def test_handles_no_data_to_delete(self, service, mock_bq_client):
        _mock_query_result(mock_bq_client, [0, 0, 0, 0])

        result = service.run("99999", "corr-456")

        assert result.activities_archived == 0
        assert result.activities_deleted == 0
        assert result.staging_deleted == 0
        assert result.archive_deleted == 0

    def test_uses_parameterized_queries(self, service, mock_bq_client):
        _mock_query_result(mock_bq_client, [0, 0, 0, 0])

        service.run("12345", "corr-123")

        # Verify all queries use the job_config with query parameters
        for c in mock_bq_client.query.call_args_list:
            job_config = c.kwargs.get("job_config") or c.args[1]
            assert job_config is not None

    def test_raises_on_bq_failure(self, service, mock_bq_client):
        job = MagicMock()
        job.result.side_effect = Exception("BQ error")
        mock_bq_client.query.return_value = job

        with pytest.raises(Exception, match="BQ error"):
            service.run("12345", "corr-123")
