"""Database assertions and historical writer fixtures for external activity IDs."""

from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session


def upsert_legacy_tombstone(
    session: Session, external_id: int, event_time: int
) -> None:
    """The deployed pre-V0014 DELETE SQL, kept to test rolling upgrades.

    Testing only the current repository would miss a migration that breaks
    old writer images. The fixed timestamp also pins metadata preservation.
    """
    session.execute(
        text("""
            INSERT INTO desirelines.deleted_activities
                (id, source, deletion_event_time, deleted_at, deletion_correlation_id)
            VALUES (:id, 'strava', :event_time, :deleted_at, :correlation_id)
            ON CONFLICT (id) DO UPDATE SET
                deletion_event_time = GREATEST(
                    deleted_activities.deletion_event_time, EXCLUDED.deletion_event_time),
                deleted_at = CASE
                    WHEN EXCLUDED.deletion_event_time >= deleted_activities.deletion_event_time
                    THEN EXCLUDED.deleted_at ELSE deleted_activities.deleted_at END,
                deletion_correlation_id = CASE
                    WHEN EXCLUDED.deletion_event_time >= deleted_activities.deletion_event_time
                    THEN EXCLUDED.deletion_correlation_id
                    ELSE deleted_activities.deletion_correlation_id END
        """),
        {
            "id": external_id,
            "event_time": event_time,
            "deleted_at": datetime(2026, 10, 10, tzinfo=UTC),
            "correlation_id": f"legacy-{event_time}",
        },
    )


def activity_id_for(session: Session | Connection, external_id: int) -> int | None:
    """Resolve a fixture's Strava ID; deleted or blocked fixtures have no mapping."""
    return session.execute(
        text("""
            SELECT activity_id FROM desirelines.activity_external_ids
            WHERE source = 'strava' AND external_id = :external_id
        """),
        {"external_id": str(external_id)},
    ).scalar_one_or_none()
