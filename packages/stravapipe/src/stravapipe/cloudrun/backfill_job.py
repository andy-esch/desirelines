"""Cloud Run Job entrypoint for backfilling historical Strava activities.

This is NOT a web server — it's a batch job that runs to completion.
Triggered by `gcloud run jobs execute` with ATHLETE_ID set as an env var.

Usage (Cloud Run):
    gcloud run jobs execute backfill \
        --set-env-vars ATHLETE_ID=12345,BACKFILL_YEARS=2023,2024,2025

Usage (local):
    ATHLETE_ID=12345 BACKFILL_YEARS=2024,2025 \
    GCP_PROJECT_ID=desirelines-dev \
    POSTGRES_CONNECTION_STRING="postgresql://..." \
    STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... \
    GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \
        uv run python -m stravapipe.cloudrun.backfill_job

    Strava client creds can also be loaded from secret volume mounts
    (INFISICAL_STRAVA_CLIENT_ID, INFISICAL_STRAVA_CLIENT_SECRET).
    Per-user OAuth tokens are fetched from Firestore via ATHLETE_ID.
"""

import logging
import sys

from google.cloud.firestore_v1 import Client as FirestoreClient

from stravapipe.adapters.firestore import FirestoreTokenStore
from stravapipe.adapters.gcp import make_write_activities
from stravapipe.adapters.postgres import SqlAlchemyUnitOfWork, create_session_factory
from stravapipe.adapters.strava import create_strava_activities_repo
from stravapipe.application.backfill import BackfillService
from stravapipe.config.backfill import load_backfill_config
from stravapipe.domain import StravaTokenSet

logger = logging.getLogger(__name__)


def main() -> None:
    """Run the backfill job."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger.info("Loading backfill configuration...")
    config = load_backfill_config()

    logger.info(
        "Backfill configuration: athlete_id=%s, years=%s, bq=%s",
        config.athlete_id,
        config.years,
        config.gcp_bigquery_dataset is not None,
    )

    # --- Wire up dependencies ---

    # Strava API client — tokens from Firestore, client creds from config (secret mounts)
    firestore_client = FirestoreClient(
        project=config.gcp_project_id,
        database=config.firestore_database,
    )
    token_store = FirestoreTokenStore(firestore_client)
    token_data = token_store.get_tokens(config.athlete_id)

    tokens = StravaTokenSet(
        client_id=int(config.strava_client_id),
        client_secret=config.strava_client_secret,
        access_token=token_data.access_token,
        refresh_token=token_data.refresh_token,
    )
    strava_repo = create_strava_activities_repo(tokens)

    # PostgreSQL
    db_engine, session_factory = create_session_factory(
        config.postgres_connection_string
    )

    def create_uow() -> SqlAlchemyUnitOfWork:
        return SqlAlchemyUnitOfWork(session_factory)

    # BigQuery (optional)
    bq_writer = None
    if config.gcp_bigquery_dataset:
        bq_writer = make_write_activities(
            project_id=config.gcp_project_id,
            bq_dataset=config.gcp_bigquery_dataset,
        )

    # --- Run backfill ---

    service = BackfillService(
        strava_reader=strava_repo,
        uow_factory=create_uow,
        bq_writer=bq_writer,
        batch_size=config.batch_size,
    )

    try:
        result = service.backfill_user(
            athlete_id=config.athlete_id,
            years=config.years,
        )
    finally:
        if bq_writer is not None:
            bq_writer.close()
        db_engine.dispose()

    # --- Exit ---

    if result.success:
        logger.info(
            "Backfill succeeded: %d activities (%d PG, %d BQ) in %.1fs",
            result.total_activities,
            result.total_pg_inserted,
            result.total_bq_inserted,
            result.duration_seconds,
        )
        sys.exit(0)
    else:
        logger.error("Backfill completed with %d errors", result.total_errors)
        sys.exit(1)


if __name__ == "__main__":
    main()
