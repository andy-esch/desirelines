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
        python -m stravapipe.cloudrun.backfill_job
"""

import logging
import sys

from stravapipe.adapters.gcp import ActivitiesWriter, BigQueryClientWrapper
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

    # Strava API client
    # TODO(multiuser-07): Replace with per-user Firestore token repository
    # For now, tokens must be provided via environment variables.
    # access_token is empty — StravaTokenManager will refresh on first use.
    tokens = StravaTokenSet(
        client_id=int(_require_env("STRAVA_CLIENT_ID")),
        client_secret=_require_env("STRAVA_CLIENT_SECRET"),
        access_token="",
        refresh_token=_require_env("STRAVA_REFRESH_TOKEN"),
    )
    strava_repo = create_strava_activities_repo(tokens)

    # PostgreSQL
    session_factory = create_session_factory(config.postgres_connection_string)
    uow_factory = lambda: SqlAlchemyUnitOfWork(session_factory)  # noqa: E731

    # BigQuery (optional)
    bq_writer = None
    if config.gcp_bigquery_dataset:
        bq_client = BigQueryClientWrapper(project_id=config.gcp_project_id)
        bq_writer = ActivitiesWriter(
            client=bq_client,
            dataset_name=config.gcp_bigquery_dataset,
        )

    # --- Run backfill ---

    service = BackfillService(
        strava_reader=strava_repo,
        uow_factory=uow_factory,
        bq_writer=bq_writer,
        batch_size=config.batch_size,
    )

    result = service.backfill_user(
        athlete_id=config.athlete_id,
        years=config.years,
    )

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
        logger.error(
            "Backfill completed with %d errors", result.total_errors
        )
        sys.exit(1)


def _require_env(name: str) -> str:
    """Read a required environment variable."""
    import os

    value = os.environ.get(name)
    if not value:
        logger.error("Required environment variable %s is not set", name)
        sys.exit(1)
    return value


if __name__ == "__main__":
    main()
