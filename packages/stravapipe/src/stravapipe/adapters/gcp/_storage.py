"""Cloud Storage adapters for summary and timeseries data."""

import logging

from google.cloud.storage.client import NotFound
from google.protobuf import json_format

from stravapipe.adapters.gcp._clients import CloudStorageClientWrapper
from stravapipe.ports.out.read import ReadSummaries
from stravapipe.ports.out.write import WriteDistances, WriteMetadata, WriteSummary
from stravapipe.types import DistanceTimeseries, SummaryObject
from stravapipe.types.generated.sports_metrics_pb2 import DailySummary, YearMetadata

logger = logging.getLogger(__name__)


class SummariesRepo(ReadSummaries, WriteSummary):
    def __init__(self, client: CloudStorageClientWrapper):
        self._client = client

    def read_activity_summary_by_year(self, year: int) -> SummaryObject:
        """Read Activity summaries by year (legacy, cycling only)"""
        blob_name = f"activities/{year}/summary_activities.json"
        try:
            summary = self._client.read_json_from_bucket(blob_name)
        except NotFound:
            summary = {}

        return summary

    def read_activity_summary_by_year_and_sport(
        self, year: int, sport: str
    ) -> DailySummary:
        """Read activity summary for a specific year and sport.

        Args:
            year: Year (e.g., 2024)
            sport: Sport name (e.g., "cycling")

        Returns:
            DailySummary protobuf message
        """
        blob_name = f"activities/{year}/source/{sport}.json"
        try:
            json_dict = self._client.read_json_from_bucket(blob_name)
        except NotFound:
            logger.info("No existing summary for year=%s, sport=%s", year, sport)
            json_dict = {}

        # Convert JSON dict to DailySummary protobuf
        # The stored format is a flat date-keyed dict, wrap it in {"daily": {...}}
        summary = DailySummary()
        json_format.ParseDict({"daily": json_dict}, summary)
        return summary

    def update(self, summary: DailySummary, *, year: int, sport: str) -> None:
        """Update summary for a specific sport.

        Args:
            summary: DailySummary protobuf message
            year: Year
            sport: Sport name
        """
        summary_blob_name = f"activities/{year}/source/{sport}.json"

        # Convert protobuf to JSON (just the daily map, not the wrapper)
        summary_dict = json_format.MessageToDict(
            summary,
            preserving_proto_field_name=True,
        )

        # Extract just the 'daily' field for backwards compatibility
        # (source files are just date-keyed dicts, not wrapped in {"daily": {...}})
        json_dict = summary_dict.get("daily", {})

        # Upload to GCP bucket
        logger.info("Writing summary to blob: %s", summary_blob_name)
        self._client.write_json_to_bucket(json_dict, summary_blob_name)

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

    def update(
        self, distances: dict[str, DistanceTimeseries], *, year: int, sport: str
    ) -> None:
        """Write distances data to external storage for a specific sport"""
        distances_blob_name = f"activities/{year}/metrics/{sport}.json"

        # upload data to gcp bucket
        logger.info("Writing distances to blob: %s", distances_blob_name)
        self._client.write_json_to_bucket(distances, distances_blob_name)


class MetadataRepo(WriteMetadata):
    def __init__(self, client: CloudStorageClientWrapper):
        self._client = client

    def update(self, metadata: YearMetadata, *, year: int) -> None:
        """Write year metadata with sport totals"""
        metadata_blob_name = f"activities/{year}/metadata.json"

        # Convert protobuf to JSON
        metadata_json = json_format.MessageToJson(
            metadata,
            preserving_proto_field_name=True,
        )

        # Upload to GCP bucket
        logger.info("Writing metadata to blob: %s", metadata_blob_name)
        blob = self._client._bucket.blob(metadata_blob_name)
        blob.upload_from_string(data=metadata_json, content_type="application/json")
