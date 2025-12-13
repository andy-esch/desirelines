"""Tests for responses module"""

from stravapipe.cfutils.responses import (
    error_response,
    skipped_response,
    success_response,
)


class TestSuccessResponse:
    """Tests for success_response function"""

    def test_basic_success_response(self):
        """Should create valid success response"""
        result = success_response(
            action="created",
            activity_id=12345,
            correlation_id="abc-123",
        )

        assert result == {
            "status": "processed",
            "action": "created",
            "activity_id": 12345,
            "correlation_id": "abc-123",
        }

    def test_with_none_activity_id(self):
        """Should handle None activity_id"""
        result = success_response(
            action="deleted",
            activity_id=None,
            correlation_id="xyz-789",
        )

        assert result["activity_id"] is None
        assert result["status"] == "processed"

    def test_different_actions(self):
        """Should work with different action types"""
        actions = ["created", "updated", "deleted", "processed"]

        for action in actions:
            result = success_response(
                action=action,
                activity_id=999,
                correlation_id="test",
            )
            assert result["action"] == action


class TestSkippedResponse:
    """Tests for skipped_response function"""

    def test_basic_skipped_response(self):
        """Should create valid skipped response"""
        result = skipped_response(
            reason="activity_not_found",
            correlation_id="abc-123",
        )

        assert result == {
            "status": "skipped",
            "reason": "activity_not_found",
            "activity_id": None,
            "correlation_id": "abc-123",
            "details": None,
        }

    def test_with_activity_id(self):
        """Should include activity_id when provided"""
        result = skipped_response(
            reason="wrong_type",
            correlation_id="abc-123",
            activity_id=456,
        )

        assert result["activity_id"] == 456

    def test_with_details(self):
        """Should include details when provided"""
        result = skipped_response(
            reason="validation_failed",
            correlation_id="abc-123",
            details="Activity type not supported",
        )

        assert result["details"] == "Activity type not supported"

    def test_with_all_fields(self):
        """Should include all fields when provided"""
        result = skipped_response(
            reason="filtered_out",
            correlation_id="abc-123",
            activity_id=789,
            details="Activity filtered by type",
        )

        assert result == {
            "status": "skipped",
            "reason": "filtered_out",
            "activity_id": 789,
            "correlation_id": "abc-123",
            "details": "Activity filtered by type",
        }


class TestErrorResponse:
    """Tests for error_response function"""

    def test_basic_error_response(self):
        """Should create valid error response"""
        result = error_response(
            error_type="decode_error",
            details="Failed to decode base64",
            correlation_id="abc-123",
        )

        assert result == {
            "status": "failed",
            "error": "decode_error",
            "details": "Failed to decode base64",
            "correlation_id": "abc-123",
        }

    def test_different_error_types(self):
        """Should work with different error types"""
        error_types = [
            "validation_failed",
            "decode_error",
            "api_error",
            "timeout",
        ]

        for error_type in error_types:
            result = error_response(
                error_type=error_type,
                details="Some error details",
                correlation_id="test",
            )
            assert result["error"] == error_type
            assert result["status"] == "failed"

    def test_with_long_details(self):
        """Should handle long error details"""
        long_details = "A" * 1000

        result = error_response(
            error_type="processing_error",
            details=long_details,
            correlation_id="abc-123",
        )

        assert result["details"] == long_details
        assert len(result["details"]) == 1000


class TestResponseConsistency:
    """Tests for consistency across response types"""

    def test_all_responses_have_correlation_id(self):
        """All response types should include correlation_id"""
        correlation_id = "test-123"

        success = success_response("created", 123, correlation_id)
        skipped = skipped_response("test", correlation_id)
        error = error_response("test_error", "details", correlation_id)

        assert success["correlation_id"] == correlation_id
        assert skipped["correlation_id"] == correlation_id
        assert error["correlation_id"] == correlation_id

    def test_all_responses_have_status(self):
        """All response types should include status field"""
        success = success_response("created", 123, "cor-123")
        skipped = skipped_response("test", "cor-123")
        error = error_response("test_error", "details", "cor-123")

        assert "status" in success
        assert "status" in skipped
        assert "status" in error

    def test_status_values_are_unique(self):
        """Each response type should have unique status value"""
        success = success_response("created", 123, "cor-123")
        skipped = skipped_response("test", "cor-123")
        error = error_response("test_error", "details", "cor-123")

        statuses = {success["status"], skipped["status"], error["status"]}
        assert len(statuses) == 3  # All unique
        assert statuses == {"processed", "skipped", "failed"}
