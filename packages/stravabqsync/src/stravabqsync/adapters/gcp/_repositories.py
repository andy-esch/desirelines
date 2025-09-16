from stravabqsync.adapters.gcp._clients import BigQueryClientWrapper
from stravabqsync.domain import StravaActivity
from stravabqsync.ports.out.write import WriteActivities


class WriteActivitiesRepo(WriteActivities):
    """Write Strava Activities to BigQuery"""

    def __init__(self, client: BigQueryClientWrapper, *, dataset_name: str):
        self._client = client
        self._dataset_name = dataset_name
        self._table_name = "activities"

    def write_activity(self, activity: StravaActivity) -> None:
        activities_dict = [activity.model_dump(mode="json")]
        self._client.insert_rows_json(
            activities_dict,
            dataset_name=self._dataset_name,
            table_name=self._table_name,
        )
