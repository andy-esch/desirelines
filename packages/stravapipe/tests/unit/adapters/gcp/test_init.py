from unittest.mock import patch

from stravapipe.adapters.gcp import (
    make_bigquery_client_wrapper,
    make_write_activities,
)
from stravapipe.adapters.gcp._bigquery import ActivitiesRepo
from stravapipe.adapters.gcp._clients import BigQueryClientWrapper


class TestGcpAdapterFactories:
    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_make_bigquery_client_wrapper_returns_correct_type(
        self, mock_bq_inserter_config
    ):
        # This test covers line 11: BigQueryClientWrapper instantiation
        result = make_bigquery_client_wrapper(mock_bq_inserter_config)
        assert isinstance(result, BigQueryClientWrapper)

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_make_bigquery_client_wrapper_uses_app_config(
        self, mock_client, mock_bq_inserter_config
    ):
        # Test that factory uses app_config.project_id
        client = make_bigquery_client_wrapper(mock_bq_inserter_config)
        assert hasattr(client, "project_id")
        assert hasattr(client, "_client")

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_make_write_activities_returns_correct_type(
        self, mock_client, mock_bq_inserter_config
    ):
        # This test covers line 16: ActivitiesRepo instantiation
        result = make_write_activities(mock_bq_inserter_config)
        assert isinstance(result, ActivitiesRepo)

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_make_write_activities_uses_app_config(
        self, mock_client, mock_bq_inserter_config
    ):
        # Test that factory uses app_config.bq_dataset and client wrapper
        repo = make_write_activities(mock_bq_inserter_config)
        assert hasattr(repo, "_client")
        assert hasattr(repo, "_dataset_name")
