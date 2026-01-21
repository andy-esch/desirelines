"""Tests for webhook proto adapter."""

import pytest

from stravapipe.adapters.proto import (
    dict_to_webhook_event,
    proto_to_dict,
    validate_webhook_event,
)
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
        assert event.updates.title == "Morning Run"
        assert event.updates.private is False

    def test_update_with_type_change(self):
        """Test parsing an update webhook with type change."""
        data = {
            "aspect_type": "update",
            "object_type": "activity",
            "object_id": 12345,
            "owner_id": 67890,
            "event_time": 1704067200,
            "subscription_id": 999,
            "updates": {"type": "Ride"},
        }
        event = dict_to_webhook_event(data)

        assert event.updates.type == "Ride"
        assert not event.updates.HasField("title")

    def test_create_event_no_updates(self):
        """Test that CREATE events don't have updates populated."""
        data = {
            "aspect_type": "create",
            "object_type": "activity",
            "object_id": 12345,
            "owner_id": 67890,
            "event_time": 1704067200,
            "subscription_id": 999,
        }
        event = dict_to_webhook_event(data)

        assert not event.updates.ByteSize()  # Empty message

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

    def test_roundtrip_with_updates(self):
        """Test that dict -> proto -> dict preserves data for activity updates."""
        original = {
            "aspect_type": "update",
            "object_type": "activity",
            "object_id": 12345,
            "owner_id": 67890,
            "event_time": 1704067200,
            "subscription_id": 999,
            "updates": {"title": "Test", "type": "Run"},
        }
        event = dict_to_webhook_event(original)
        result = proto_to_dict(event)

        assert result == original

    def test_roundtrip_create_event(self):
        """Test roundtrip for create events (no updates)."""
        original = {
            "aspect_type": "create",
            "object_type": "activity",
            "object_id": 12345,
            "owner_id": 67890,
            "event_time": 1704067200,
            "subscription_id": 999,
            "updates": {},
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
