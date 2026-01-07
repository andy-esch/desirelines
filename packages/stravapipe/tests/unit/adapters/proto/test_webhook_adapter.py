"""Tests for webhook proto adapter."""

import pytest

from stravapipe.adapters.proto import (
    dict_to_webhook_event,
    proto_to_dict,
    proto_to_pydantic,
    pydantic_to_proto,
    validate_webhook_event,
)
from stravapipe.domain.webhook import AspectType, WebhookRequest
from stravapipe.types.generated import webhook_pb2 as pb


class TestDictToWebhookEvent:
    """Tests for dict_to_webhook_event function."""

    def test_valid_create_activity(self):
        """Test parsing a valid create activity webhook."""
        data = {
            "aspect_type": "create",
            "object_type": "activity",
            "object_id": 12345,
            "owner_id": 67890,
            "event_time": 1704067200,
            "subscription_id": 999,
        }
        event = dict_to_webhook_event(data)

        assert event.aspect_type == pb.ASPECT_TYPE_CREATE
        assert event.object_type == pb.OBJECT_TYPE_ACTIVITY
        assert event.object_id == 12345
        assert event.owner_id == 67890
        assert event.event_time == 1704067200
        assert event.subscription_id == 999

    def test_valid_update_with_updates(self):
        """Test parsing an update webhook with updates dict."""
        data = {
            "aspect_type": "update",
            "object_type": "activity",
            "object_id": 12345,
            "owner_id": 67890,
            "event_time": 1704067200,
            "subscription_id": 999,
            "updates": {"title": "Morning Run", "private": "false"},
        }
        event = dict_to_webhook_event(data)

        assert event.aspect_type == pb.ASPECT_TYPE_UPDATE
        assert dict(event.updates) == {"title": "Morning Run", "private": "false"}

    def test_valid_delete_athlete(self):
        """Test parsing a delete athlete webhook."""
        data = {
            "aspect_type": "delete",
            "object_type": "athlete",
            "object_id": 12345,
            "owner_id": 67890,
            "event_time": 1704067200,
            "subscription_id": 999,
        }
        event = dict_to_webhook_event(data)

        assert event.aspect_type == pb.ASPECT_TYPE_DELETE
        assert event.object_type == pb.OBJECT_TYPE_ATHLETE

    def test_invalid_aspect_type(self):
        """Test that invalid aspect_type raises ValueError."""
        data = {
            "aspect_type": "invalid",
            "object_type": "activity",
            "object_id": 12345,
            "owner_id": 67890,
            "event_time": 1704067200,
            "subscription_id": 999,
        }
        with pytest.raises(ValueError, match="Invalid aspect_type"):
            dict_to_webhook_event(data)

    def test_invalid_object_type(self):
        """Test that invalid object_type raises ValueError."""
        data = {
            "aspect_type": "create",
            "object_type": "invalid",
            "object_id": 12345,
            "owner_id": 67890,
            "event_time": 1704067200,
            "subscription_id": 999,
        }
        with pytest.raises(ValueError, match="Invalid object_type"):
            dict_to_webhook_event(data)


class TestProtoToDict:
    """Tests for proto_to_dict function."""

    def test_roundtrip(self):
        """Test that dict -> proto -> dict preserves data."""
        original = {
            "aspect_type": "create",
            "object_type": "activity",
            "object_id": 12345,
            "owner_id": 67890,
            "event_time": 1704067200,
            "subscription_id": 999,
            "updates": {"title": "Test"},
        }
        event = dict_to_webhook_event(original)
        result = proto_to_dict(event)

        assert result == original

    def test_empty_updates(self):
        """Test that empty updates are handled correctly."""
        event = pb.WebhookEvent(
            aspect_type=pb.ASPECT_TYPE_CREATE,
            object_type=pb.OBJECT_TYPE_ACTIVITY,
            object_id=12345,
            owner_id=67890,
            event_time=1704067200,
            subscription_id=999,
        )
        result = proto_to_dict(event)

        assert result["updates"] == {}


class TestPydanticToProto:
    """Tests for pydantic_to_proto function."""

    def test_create_activity(self):
        """Test converting Pydantic WebhookRequest to proto."""
        request = WebhookRequest(
            aspect_type=AspectType.CREATE,
            object_type="activity",
            object_id=12345,
            owner_id=67890,
            event_time=1704067200,
            subscription_id=999,
        )
        event = pydantic_to_proto(request)

        assert event.aspect_type == pb.ASPECT_TYPE_CREATE
        assert event.object_type == pb.OBJECT_TYPE_ACTIVITY
        assert event.object_id == 12345

    def test_with_updates(self):
        """Test converting with updates dict."""
        request = WebhookRequest(
            aspect_type=AspectType.UPDATE,
            object_type="activity",
            object_id=12345,
            owner_id=67890,
            event_time=1704067200,
            subscription_id=999,
            updates={"title": "Updated Title"},
        )
        event = pydantic_to_proto(request)

        assert dict(event.updates) == {"title": "Updated Title"}


class TestProtoToPydantic:
    """Tests for proto_to_pydantic function."""

    def test_create_activity(self):
        """Test converting proto to Pydantic WebhookRequest."""
        event = pb.WebhookEvent(
            aspect_type=pb.ASPECT_TYPE_CREATE,
            object_type=pb.OBJECT_TYPE_ACTIVITY,
            object_id=12345,
            owner_id=67890,
            event_time=1704067200,
            subscription_id=999,
        )
        request = proto_to_pydantic(event)

        assert request.aspect_type == AspectType.CREATE
        assert request.object_type == "activity"
        assert request.object_id == 12345


class TestValidateWebhookEvent:
    """Tests for validate_webhook_event function."""

    def test_valid_event(self):
        """Test that valid event has no errors."""
        event = pb.WebhookEvent(
            aspect_type=pb.ASPECT_TYPE_CREATE,
            object_type=pb.OBJECT_TYPE_ACTIVITY,
            object_id=12345,
            owner_id=67890,
            event_time=1704067200,
            subscription_id=999,
        )
        errors = validate_webhook_event(event)

        assert errors == []

    def test_missing_aspect_type(self):
        """Test that missing aspect_type is caught."""
        event = pb.WebhookEvent(
            object_type=pb.OBJECT_TYPE_ACTIVITY,
            object_id=12345,
            owner_id=67890,
            event_time=1704067200,
            subscription_id=999,
        )
        errors = validate_webhook_event(event)

        assert "aspect_type is required" in errors

    def test_multiple_errors(self):
        """Test that multiple validation errors are returned."""
        event = pb.WebhookEvent()
        errors = validate_webhook_event(event)

        assert len(errors) == 6
        assert "aspect_type is required" in errors
        assert "object_type is required" in errors
        assert "event_time is required" in errors
        assert "object_id is required" in errors
        assert "owner_id is required" in errors
        assert "subscription_id is required" in errors
