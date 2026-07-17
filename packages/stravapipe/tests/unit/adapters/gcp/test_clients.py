from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from google.api_core.exceptions import BadRequest
import pytest

from stravapipe.adapters.gcp._clients import BigQueryClientWrapper
from stravapipe.exceptions import BigQueryError, StreamingBufferDMLError


class TestBigQueryClientWrapper:
    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_init(self, mock_client_class):
        # This test covers lines 12-13: constructor
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        wrapper = BigQueryClientWrapper(project_id="test-project")

        assert wrapper.project_id == "test-project"
        assert wrapper._client == mock_client_instance
        mock_client_class.assert_called_once_with(project="test-project")

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_execute_merge_query_success(self, mock_client_class):
        # Test successful merge query execution
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Mock successful query job
        mock_job = MagicMock()
        mock_job.result.return_value = None
        mock_job.num_dml_affected_rows = 5
        mock_job.ended = datetime(2024, 1, 1, 12, 0, 1, tzinfo=UTC)
        mock_job.started = datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC)
        mock_job.job_id = "test-job-123"
        mock_client_instance.query.return_value = mock_job

        wrapper = BigQueryClientWrapper(project_id="test-project")
        test_query = (
            "MERGE INTO activities AS target USING activities_staging AS source"
        )

        result = wrapper.execute_merge_query(test_query)

        assert result["rows_affected"] == 5
        assert result["execution_time_ms"] == 1000  # 1 second = 1000ms
        assert result["job_id"] == "test-job-123"
        assert "query_preview" in result
        mock_client_instance.query.assert_called_once()

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_execute_merge_query_failure(self, mock_client_class):
        # Test merge query execution failure
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Mock query job that fails
        mock_job = MagicMock()
        mock_job.result.side_effect = Exception("Query failed")
        mock_client_instance.query.return_value = mock_job

        wrapper = BigQueryClientWrapper(project_id="test-project")
        test_query = (
            "MERGE INTO activities AS target USING activities_staging AS source"
        )

        with pytest.raises(BigQueryError) as exc_info:
            wrapper.execute_merge_query(test_query)

        assert "Failed to execute MERGE query" in str(exc_info.value)
        mock_client_instance.query.assert_called_once()

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_execute_dml_query_streaming_buffer_raises_typed_error(
        self, mock_client_class, caplog
    ):
        """Streaming-buffer rejection raises StreamingBufferDMLError silently.

        The boundary must NOT log at ERROR for this case — it's an expected
        condition during the ~90-min buffer window after a streaming insert.
        Caller (e.g. _cleanup_staging) decides log severity.
        """
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        mock_job = MagicMock()
        mock_job.job_id = "test-job-123"
        mock_job.result.side_effect = BadRequest(
            "UPDATE or DELETE statement over table x.y.z would affect "
            "rows in the streaming buffer, which is not supported"
        )
        mock_client_instance.query.return_value = mock_job

        wrapper = BigQueryClientWrapper(project_id="test-project")

        with caplog.at_level("ERROR"), pytest.raises(StreamingBufferDMLError):
            wrapper.execute_dml_query("DELETE FROM x.y.z WHERE id = @id")

        assert not caplog.records, (
            "execute_dml_query must not log at ERROR for streaming-buffer "
            f"rejections; caller decides severity. Got: {caplog.records}"
        )

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_execute_dml_query_other_bad_request_logs_and_wraps(
        self, mock_client_class, caplog
    ):
        """Non-streaming-buffer BadRequest still logs ERROR and raises BigQueryError."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        mock_job = MagicMock()
        mock_job.job_id = "test-job-456"
        mock_job.result.side_effect = BadRequest(
            "Syntax error: Unexpected keyword FROM"
        )
        mock_client_instance.query.return_value = mock_job

        wrapper = BigQueryClientWrapper(project_id="test-project")

        with caplog.at_level("ERROR"), pytest.raises(BigQueryError) as exc_info:
            wrapper.execute_dml_query("DELETE BROKEN")

        assert not isinstance(exc_info.value, StreamingBufferDMLError)
        assert any(r.levelname == "ERROR" for r in caplog.records), (
            "Non-streaming-buffer BadRequest should log at ERROR"
        )

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_execute_dml_query_generic_failure_logs_and_wraps(
        self, mock_client_class, caplog
    ):
        """Non-BadRequest exception is logged at ERROR and wrapped as BigQueryError."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        mock_job = MagicMock()
        mock_job.job_id = "test-job-789"
        mock_job.result.side_effect = RuntimeError("connection refused")
        mock_client_instance.query.return_value = mock_job

        wrapper = BigQueryClientWrapper(project_id="test-project")

        with caplog.at_level("ERROR"), pytest.raises(BigQueryError) as exc_info:
            wrapper.execute_dml_query("DELETE FROM x.y.z")

        assert "Failed to execute DML query" in str(exc_info.value)
        assert any(r.levelname == "ERROR" for r in caplog.records)

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_execute_dml_query_success_returns_rows_affected(self, mock_client_class):
        """Happy path: returns num_dml_affected_rows from the job."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        mock_job = MagicMock()
        mock_job.job_id = "test-job-ok"
        mock_job.result.return_value = None
        mock_job.num_dml_affected_rows = 7
        mock_client_instance.query.return_value = mock_job

        wrapper = BigQueryClientWrapper(project_id="test-project")
        rows = wrapper.execute_dml_query("DELETE FROM x.y.z WHERE id = @id")

        assert rows == 7
