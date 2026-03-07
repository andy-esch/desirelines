from unittest.mock import patch

from stravapipe.application.bq_inserter import make_delete_service
from stravapipe.application.bq_inserter.delete_service import DeleteActivityService


class TestApplicationServicesFactories:
    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_make_delete_service_returns_correct_type(
        self, mock_bq_client, mock_bq_inserter_config
    ):
        result = make_delete_service(mock_bq_inserter_config)
        assert isinstance(result, DeleteActivityService)

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    def test_make_delete_service_has_required_dependencies(
        self, mock_bq_client, mock_bq_inserter_config
    ):
        service = make_delete_service(mock_bq_inserter_config)
        assert hasattr(service, "_client")
        assert hasattr(service, "_dataset_id")
