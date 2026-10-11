"""Database assertions and historical writer fixtures for external activity IDs."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session


def database_resource(relative: str) -> Path:
    """Find real migration resources in a checkout or Pants' resource sandbox."""
    for parent in Path(__file__).resolve().parents:
        path = parent / "schemas/database" / relative
        if path.is_file():
            return path
    raise FileNotFoundError(f"Missing database fixture resource: {relative}")


@contextmanager
def migrated_database(db_url: str, version: int) -> Iterator[Engine]:
    """An isolated historical database; never downgrade the suite's database.

    The integration login needs CREATEDB (CI and local PostGIS use a superuser).
    Apply the real callback/migrations, and drop only our uniquely named database
    even when initialization or a test fails. This also isolates committed races.
    """
    admin = create_engine(db_url, isolation_level="AUTOCOMMIT")
    name = f"desirelines_history_{uuid4().hex}"
    history = create_engine(admin.url.set(database=name))
    created = False
    try:
        with admin.connect() as connection:
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
            created = True
        with history.begin() as connection:
            connection.exec_driver_sql("CREATE EXTENSION postgis")
            connection.execute(
                text(database_resource("callbacks/beforeMigrate.sql").read_text())
            )
            migrations = database_resource("migrations/V0001__role_groups.sql").parent
            for migration in sorted(migrations.glob("V*.sql")):
                if int(migration.name.split("__")[0][1:]) <= version:
                    connection.execute(text(migration.read_text()))
        yield history
    finally:
        history.dispose()
        try:
            if created:
                with admin.connect() as connection:
                    connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        finally:
            admin.dispose()


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
