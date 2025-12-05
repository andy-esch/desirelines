from google.protobuf import json_format

from stravapipe.ports.out.read import ReadSummaries
from stravapipe.types.generated.sports_metrics_pb2 import DailySummary


class MockReadSummaries(ReadSummaries):
    def __init__(self, summaries: dict):
        self.summaries = summaries

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
        year_data = self.summaries.get(year, {})

        # Handle different test data formats
        if isinstance(year_data, dict):
            # Check if this is sport-keyed data (new multi-sport format)
            if sport in year_data and isinstance(year_data[sport], dict):
                json_dict = year_data[sport]
            # Check if year_data has date keys (legacy single-sport format)
            elif any(key.startswith("20") for key in year_data.keys()):
                # Legacy: year_data is the daily dict itself
                json_dict = year_data
            else:
                # Sport not found in multi-sport data
                json_dict = {}
        else:
            json_dict = {}

        # Convert to DailySummary protobuf
        summary = DailySummary()
        if json_dict:
            json_format.ParseDict({"daily": json_dict}, summary)
        return summary
