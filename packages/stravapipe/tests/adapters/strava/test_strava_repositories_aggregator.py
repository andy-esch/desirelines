"""Tests for Strava adapter repositories"""

from unittest.mock import Mock, patch

import pytest
import requests

from stravapipe.adapters.strava._repositories import MinimalStravaActivitiesRepo
from stravapipe.domain import StravaTokenSet
from stravapipe.exceptions import ActivityNotFoundError


class TestStravaActivitiesRepo:
    """Tests for StravaActivitiesRepo"""

    @pytest.fixture
    def tokens(self):
        """Mock Strava token set"""
        return StravaTokenSet(
            client_id="test_client_id",
            client_secret="test_client_secret",
            access_token="test_access_token",
            refresh_token="test_refresh_token",
        )

    @pytest.fixture
    def repo(self, tokens):
        """Create MinimalStravaActivitiesRepo instance"""
        return MinimalStravaActivitiesRepo(tokens)

    def test_read_activity_by_id_raises_activity_not_found_error_on_404(self, repo):
        """Test that ActivityNotFoundError is raised when Strava API returns 404"""
        activity_id = 12345678

        # Mock the requests.get call to return 404
        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.ok = False

        with patch("requests.get", return_value=mock_response):
            with pytest.raises(ActivityNotFoundError) as exc_info:
                repo.read_activity_by_id(activity_id)

            assert str(activity_id) in str(exc_info.value)
            assert "not found" in str(exc_info.value).lower()

    def test_read_activity_by_id_raises_http_error_on_other_errors(self, repo):
        """Test that other HTTP errors still raise HTTPError"""
        activity_id = 12345678

        # Mock the requests.get call to return 500 (server error)
        mock_response = Mock()
        mock_response.status_code = 500
        mock_response.ok = False
        mock_response.raise_for_status.side_effect = requests.HTTPError("Server Error")

        with patch("requests.get", return_value=mock_response):
            with pytest.raises(requests.HTTPError):
                repo.read_activity_by_id(activity_id)

    def test_read_activity_by_id_success(self, repo):
        """Test successful activity fetch"""
        activity_id = 12345678
        mock_activity_data = {
            "id": activity_id,
            "type": "Run",
            "distance": 5000.0,
            "start_date_local": "2025-10-09T10:00:00",
        }

        # Mock successful response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.ok = True
        mock_response.json.return_value = mock_activity_data

        with patch("requests.get", return_value=mock_response):
            activity = repo.read_activity_by_id(activity_id)
            assert activity.id == activity_id
            assert activity.type == "Run"
            assert activity.distance == 5000.0
