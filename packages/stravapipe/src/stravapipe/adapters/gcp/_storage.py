"""Cloud Storage adapters for summary and timeseries data."""

import logging

from google.cloud.storage.client import NotFound

from stravapipe.adapters.gcp._clients import CloudStorageClientWrapper
from stravapipe.ports.out.read import ReadSummaries
from stravapipe.ports.out.write import WriteDistances, WriteSummary
from stravapipe.types import DistanceTimeseries, SummaryObject

logger = logging.getLogger(__name__)


class SummariesRepo(ReadSummaries, WriteSummary):
    def __init__(self, client: CloudStorageClientWrapper):
        self._client = client

    def read_activity_summary_by_year(self, year: int) -> SummaryObject:
        """Read Activity summaries by year"""
        blob_name = f"activities/{year}/summary_activities.json"
        try:
            summary = self._client.read_json_from_bucket(blob_name)
        except NotFound:
            summary = {}

        return summary

    def update(self, summary: SummaryObject, *, year: int) -> None:
        """Update summary"""
        summary_blob_name = f"activities/{year}/summary_activities.json"

        # upload data to gcp bucket
        logger.info("Writing summary to blob: %s", summary_blob_name)
        self._client.write_json_to_bucket(summary, summary_blob_name)

    def update_chart_distances(
        self, distances: DistanceTimeseries, *, year: int
    ) -> None:
        """Update chart distances object"""
        distances_blob_name = f"activities/{year}/chart_distances.json"

        logger.info("Writing chart distances to blob: %s", distances_blob_name)
        self._client.write_json_to_bucket(distances, distances_blob_name)


class DistancesRepo(WriteDistances):
    def __init__(self, client: CloudStorageClientWrapper):
        self._client = client

    def update(self, distances: DistanceTimeseries, *, year: int) -> None:
        """Write distances data to external storage"""
        distances_blob_name = f"activities/{year}/distances.json"

        # upload data to gcp bucket
        logger.info("Writing distances to blob: %s", distances_blob_name)
        self._client.write_json_to_bucket(distances, distances_blob_name)
