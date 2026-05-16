from unittest.mock import patch

from stravapipe.adapters.gcp import (
    make_bigquery_client_wrapper,
    make_read_activities,
    make_write_activities,
)
from stravapipe.adapters.gcp._bigquery import ActivitiesReader, ActivitiesWriter
from stravapipe.adapters.gcp._clients import BigQueryClientWrapper


class TestGcpAdapterFactories:
    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_make_bigquery_client_wrapper_returns_correct_type(self, mock_client):
        result = make_bigquery_client_wrapper(project_id="test-project")
        assert isinstance(result, BigQueryClientWrapper)
        assert result.project_id == "test-project"

    @patch("stravapipe.adapters.gcp.BigQueryStorageWriter")
    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_make_write_activities_returns_correct_type(
        self, mock_client, mock_storage_writer
    ):
        result = make_write_activities(
            project_id="test-project", bq_dataset="test_dataset"
        )
        assert isinstance(result, ActivitiesWriter)
        assert result._dataset_name == "test_dataset"

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_make_read_activities_returns_correct_type(self, mock_client):
        result = make_read_activities(
            project_id="test-project", bq_dataset="test_dataset"
        )
        assert isinstance(result, ActivitiesReader)
        assert result._dataset_name == "test_dataset"
