"""Tests for webhook proto adapter."""

import json
from pathlib import Path

import pytest

from stravapipe.adapters.proto import (
    dict_to_webhook_event,
    proto_to_dict,
    validate_webhook_event,
)
from stravapipe.types.generated import webhook_pb2 as pb


def _resolve_fixtures_path() -> Path:
    """Resolve fixtures path for both uv (repo root) and Pants (sandbox) contexts."""
    # uv pytest: navigate from test file to repo root
    repo_root_path = (
        Path(__file__).parents[6] / "schemas" / "test-fixtures" / "webhook_events.json"
    )
    if repo_root_path.exists():
        return repo_root_path
    # Pants sandbox: schemas/ source root is stripped, file is at test-fixtures/
    return Path("test-fixtures") / "webhook_events.json"


FIXTURES_PATH = _resolve_fixtures_path()


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


_FIXTURES = json.loads(FIXTURES_PATH.read_text())
_FIXTURE_IDS = [tc["name"] for tc in _FIXTURES]
_VALID_FIXTURES = [f for f in _FIXTURES if not f["expect_error"]]
_VALID_FIXTURE_IDS = [f["name"] for f in _VALID_FIXTURES]


class TestSharedFixtures:
    """Tests driven by shared cross-language fixtures."""

    @pytest.mark.parametrize(
        "fixture",
        _FIXTURES,
        ids=_FIXTURE_IDS,
    )
    def test_parse(self, fixture: dict):
        """Test that parsing matches expected output for each fixture."""
        if fixture["expect_error"]:
            with pytest.raises(ValueError, match=r"Invalid (aspect|object)_type"):
                dict_to_webhook_event(fixture["input"])
            return

        event = dict_to_webhook_event(fixture["input"])
        expected = fixture["expected"]

        assert event.object_id == expected["object_id"]
        assert event.owner_id == expected["owner_id"]
        assert event.event_time == expected["event_time"]
        assert event.subscription_id == expected["subscription_id"]

        # Check enum fields via string comparison
        aspect_map = {
            pb.ASPECT_TYPE_CREATE: "create",
            pb.ASPECT_TYPE_UPDATE: "update",
            pb.ASPECT_TYPE_DELETE: "delete",
        }
        object_map = {
            pb.OBJECT_TYPE_ACTIVITY: "activity",
            pb.OBJECT_TYPE_ATHLETE: "athlete",
        }
        assert aspect_map[event.aspect_type] == expected["aspect_type"]
        assert object_map[event.object_type] == expected["object_type"]

        # Check updates
        expected_updates = expected.get("updates")
        if expected_updates is None:
            assert not event.updates.ByteSize(), (
                f"expected no updates, got {event.updates}"
            )
        else:
            if "title" in expected_updates:
                assert event.updates.HasField("title")
                assert event.updates.title == expected_updates["title"]
            else:
                assert not event.updates.HasField("title")

            if "type" in expected_updates:
                assert event.updates.HasField("type")
                assert event.updates.type == expected_updates["type"]
            else:
                assert not event.updates.HasField("type")

            if "private" in expected_updates:
                assert event.updates.HasField("private")
                assert event.updates.private == expected_updates["private"]
            else:
                assert not event.updates.HasField("private")

    @pytest.mark.parametrize(
        "fixture",
        _VALID_FIXTURES,
        ids=_VALID_FIXTURE_IDS,
    )
    def test_roundtrip(self, fixture: dict):
        """Test that parse -> serialize -> parse produces consistent results."""
        event = dict_to_webhook_event(fixture["input"])
        as_dict = proto_to_dict(event)
        reparsed = dict_to_webhook_event(as_dict)

        assert reparsed.aspect_type == event.aspect_type
        assert reparsed.object_type == event.object_type
        assert reparsed.object_id == event.object_id
        assert reparsed.owner_id == event.owner_id
        assert reparsed.event_time == event.event_time
        assert reparsed.subscription_id == event.subscription_id
