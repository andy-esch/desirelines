"""PostgreSQL sync services for webhook processing.

Activity data is now provided inline by the dispatcher's enriched events.
The PostgresWriteService (which fetched from Strava API) is no longer used
by the CloudRun app. The app now creates SqlAlchemyUnitOfWork directly.

The make_session_factory helper is retained for convenience.
"""

from sqlalchemy.orm import Session, sessionmaker

from stravapipe.adapters.postgres._unit_of_work import create_session_factory
from stravapipe.config import PostgresWriterConfig, load_postgres_writer_config


def make_session_factory(
    config: PostgresWriterConfig | None = None,
) -> sessionmaker[Session]:
    """Create a session factory for PostgreSQL connections.

    Call this once at startup to create a shared session factory.
    This avoids creating a new connection pool per request.

    Args:
        config: Application configuration. If None, loads from environment.

    Returns:
        SQLAlchemy sessionmaker bound to the configured database.
    """
    if config is None:
        config = load_postgres_writer_config()
    return create_session_factory(config.postgres_connection_string)


__all__ = [
    "make_session_factory",
]
