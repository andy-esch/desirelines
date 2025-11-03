from stravapipe.ports.out.read import ReadSummaries


class MockReadSummaries(ReadSummaries):
    def __init__(self, summaries: dict):
        self.summaries = summaries

    def read_activity_summary_by_year(self, year: int) -> dict:
        return self.summaries.get(year, {})

    def read_activity_summary_by_year_and_sport(self, year: int, sport: str) -> dict:
        """Read activity summary for a specific year and sport.

        Args:
            year: Year (e.g., 2024)
            sport: Sport name (e.g., "cycling")

        Returns:
            Summary object (date-keyed dict)
        """
        year_data = self.summaries.get(year, {})
        if isinstance(year_data, dict) and sport in year_data:
            return year_data[sport]
        return {}
