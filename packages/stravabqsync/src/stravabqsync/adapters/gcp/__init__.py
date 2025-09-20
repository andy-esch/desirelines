from stravabqsync.adapters.gcp._clients import BigQueryClientWrapper
from stravabqsync.adapters.gcp._repositories import WriteActivitiesRepo
from stravabqsync.config import BQInserterConfig
from stravabqsync.ports.out.write import WriteActivities


def make_bigquery_client_wrapper(config: BQInserterConfig) -> BigQueryClientWrapper:
    return BigQueryClientWrapper(project_id=config.project_id)


def make_write_activities(config: BQInserterConfig) -> WriteActivities:
    return WriteActivitiesRepo(
        client=make_bigquery_client_wrapper(config),
        dataset_name=config.bq_dataset,
        table_name="activities",
    )
