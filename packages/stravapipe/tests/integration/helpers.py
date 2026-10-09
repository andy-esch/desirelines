"""Database assertions for fixtures ingested with external activity IDs."""

from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session


def activity_id_for(session: Session | Connection, external_id: int) -> int | None:
    """Resolve a fixture's Strava ID; deleted or blocked fixtures have no mapping."""
    return session.execute(
        text("""
            SELECT activity_id FROM desirelines.activity_external_ids
            WHERE source = 'strava' AND external_id = :external_id
        """),
        {"external_id": str(external_id)},
    ).scalar_one_or_none()
