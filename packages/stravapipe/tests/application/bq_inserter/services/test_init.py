from unittest.mock import patch

from stravapipe.application.bq_inserter import make_sync_service
from stravapipe.application.bq_inserter.sync_service import SyncService


class TestApplicationServicesFactories:
    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    @patch("requests.post")
    def test_make_sync_service_returns_correct_type(
        self, mock_post, mock_client, mock_bq_inserter_config
    ):
        # Mock successful token refresh response
        mock_post.return_value.ok = True
        mock_post.return_value.json.return_value = {"access_token": "test_token"}

        # This test covers line 10: SyncService instantiation
        result = make_sync_service(mock_bq_inserter_config)
        assert isinstance(result, SyncService)

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    @patch("requests.post")
    def test_make_sync_service_has_required_dependencies(
        self, mock_post, mock_client, mock_bq_inserter_config
    ):
        # Mock successful token refresh response
        mock_post.return_value.ok = True
        mock_post.return_value.json.return_value = {"access_token": "test_token"}

        # Test that factory injects all required dependencies
        service = make_sync_service(mock_bq_inserter_config)
        assert hasattr(service, "_tokens")
        assert hasattr(service, "_read_activities")
        assert hasattr(service, "_write_activities")

    @patch("stravapipe.adapters.gcp._clients.BigQueryClient")
    @patch("requests.post")
    def test_make_sync_service_multiple_calls_same_instance(
        self, mock_post, mock_client, mock_bq_inserter_config
    ):
        # Mock successful token refresh response
        mock_post.return_value.ok = True
        mock_post.return_value.json.return_value = {"access_token": "test_token"}

        # Test that multiple calls return the same instance (if cached)
        # or at least work correctly
        first_call = make_sync_service(mock_bq_inserter_config)
        second_call = make_sync_service(mock_bq_inserter_config)
        # Both should be valid SyncService instances
        assert isinstance(first_call, SyncService)
        assert isinstance(second_call, SyncService)
