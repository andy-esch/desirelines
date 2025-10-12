from stravapipe.ports.out.read import ReadSummaries


class MockReadSummaries(ReadSummaries):
    def __init__(self, summaries: dict):
        self.summaries = summaries

    def read_activity_summary_by_year(self, year: int) -> dict:
        return self.summaries.get(year)
