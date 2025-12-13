from stravapipe.ports.out.write import WriteSummary
from stravapipe.types.generated.sports_metrics_pb2 import DailySummary


class MockWriteSummary(WriteSummary):
    def __init__(self):
        self.results = None
        self.year = None
        self.sport = None

    def update(self, summary: DailySummary, *, year: int, sport: str) -> None:
        self.results = summary
        self.year = year
        self.sport = sport
