"""Adapters for converting between Strava JSON and protobuf webhook types."""

from typing import Any

from stravapipe.types.generated import webhook_pb2 as pb


def dict_to_webhook_event(data: dict[str, Any]) -> pb.WebhookEvent:
    """Convert a dict (from JSON) to a protobuf WebhookEvent.

    Args:
        data: Dictionary with Strava webhook fields (string enums).

    Returns:
        WebhookEvent protobuf message.

    Raises:
        ValueError: If aspect_type or object_type is invalid.
    """
    aspect_type = _parse_aspect_type(data.get("aspect_type", ""))
    object_type = _parse_object_type(data.get("object_type", ""))

    event = pb.WebhookEvent(
        aspect_type=aspect_type,
        object_type=object_type,
        object_id=data.get("object_id", 0),
        owner_id=data.get("owner_id", 0),
        event_time=data.get("event_time", 0),
        subscription_id=data.get("subscription_id", 0),
    )

    # Convert updates dict to typed ActivityUpdates for activity update events
    raw_updates = data.get("updates", {})
    if (
        object_type == pb.OBJECT_TYPE_ACTIVITY
        and aspect_type == pb.ASPECT_TYPE_UPDATE
        and raw_updates
    ):
        event.updates.CopyFrom(_parse_updates(raw_updates))

    return event


def _parse_updates(raw_updates: dict[str, Any]) -> pb.ActivityUpdates:
    """Convert Strava updates dict to typed ActivityUpdates message."""
    updates = pb.ActivityUpdates()

    if "title" in raw_updates:
        updates.title = str(raw_updates["title"])

    if "type" in raw_updates:
        updates.type = str(raw_updates["type"])

    if "private" in raw_updates:
        updates.private = str(raw_updates["private"]).lower() == "true"

    return updates


def proto_to_dict(event: pb.WebhookEvent) -> dict[str, Any]:
    """Convert a protobuf WebhookEvent back to dict format.

    Args:
        event: WebhookEvent protobuf message.

    Returns:
        Dictionary with Strava webhook fields (string enums).
    """
    return {
        "aspect_type": _aspect_type_to_string(event.aspect_type),
        "object_type": _object_type_to_string(event.object_type),
        "object_id": event.object_id,
        "owner_id": event.owner_id,
        "event_time": event.event_time,
        "subscription_id": event.subscription_id,
        "updates": _updates_to_dict(event.updates),
    }


def _updates_to_dict(updates: pb.ActivityUpdates | None) -> dict[str, str]:
    """Convert typed ActivityUpdates back to dict for JSON serialization."""
    if updates is None or not updates.ByteSize():
        return {}

    result: dict[str, str] = {}

    if updates.HasField("title"):
        result["title"] = updates.title

    if updates.HasField("type"):
        result["type"] = updates.type

    if updates.HasField("private"):
        result["private"] = "true" if updates.private else "false"

    return result


def validate_webhook_event(event: pb.WebhookEvent) -> list[str]:
    """Validate a WebhookEvent and return list of errors.

    Args:
        event: WebhookEvent protobuf message.

    Returns:
        List of validation error messages. Empty if valid.
    """
    errors = []

    if event.aspect_type == pb.ASPECT_TYPE_UNSPECIFIED:
        errors.append("aspect_type is required")
    if event.object_type == pb.OBJECT_TYPE_UNSPECIFIED:
        errors.append("object_type is required")
    if event.event_time == 0:
        errors.append("event_time is required")
    if event.object_id == 0:
        errors.append("object_id is required")
    if event.owner_id == 0:
        errors.append("owner_id is required")
    if event.subscription_id == 0:
        errors.append("subscription_id is required")

    return errors


def _parse_aspect_type(s: str) -> "pb.AspectType":
    """Convert Strava string aspect_type to proto enum."""
    mapping = {
        "create": pb.ASPECT_TYPE_CREATE,
        "update": pb.ASPECT_TYPE_UPDATE,
        "delete": pb.ASPECT_TYPE_DELETE,
    }
    result = mapping.get(s)
    if result is None:
        raise ValueError(f"Invalid aspect_type: {s}")
    return result


def _parse_object_type(s: str) -> "pb.ObjectType":
    """Convert Strava string object_type to proto enum."""
    mapping = {
        "activity": pb.OBJECT_TYPE_ACTIVITY,
        "athlete": pb.OBJECT_TYPE_ATHLETE,
    }
    result = mapping.get(s)
    if result is None:
        raise ValueError(f"Invalid object_type: {s}")
    return result


def _aspect_type_to_string(at: "pb.AspectType") -> str:
    """Convert proto AspectType enum to Strava string format."""
    mapping = {
        pb.ASPECT_TYPE_CREATE: "create",
        pb.ASPECT_TYPE_UPDATE: "update",
        pb.ASPECT_TYPE_DELETE: "delete",
    }
    return mapping.get(at, "")


def _object_type_to_string(ot: "pb.ObjectType") -> str:
    """Convert proto ObjectType enum to Strava string format."""
    mapping = {
        pb.OBJECT_TYPE_ACTIVITY: "activity",
        pb.OBJECT_TYPE_ATHLETE: "athlete",
    }
    return mapping.get(ot, "")
