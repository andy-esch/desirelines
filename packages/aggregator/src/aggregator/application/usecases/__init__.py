from aggregator.adapters.gcp import make_read_summaries
from aggregator.adapters.strava import (
    make_read_strava_activities,
    make_read_strava_token,
)
from aggregator.application.services import make_export_service, make_pacing_service
from aggregator.application.usecases._update_summary import UpdateSummaryUseCase
from aggregator.config import AggregatorConfig, load_aggregator_config


def make_update_summary_use_case(
    config: AggregatorConfig | None = None,
) -> UpdateSummaryUseCase:
    if config is None:
        config = load_aggregator_config()

    return UpdateSummaryUseCase(
        config=config,
        read_activities=lambda tokens: make_read_strava_activities(tokens),
        read_summaries=lambda: make_read_summaries(config),
        read_strava_token=lambda: make_read_strava_token(config),
        pacing_service=make_pacing_service,
        export_service=lambda: make_export_service(config),
    )
