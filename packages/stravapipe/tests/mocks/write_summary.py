from stravapipe.ports.out.write import WriteSummary


class MockWriteSummary(WriteSummary):
    def __init__(self):
        self.results = None
        self.year = None

    def update(self, summary: dict, *, year: int) -> None:
        self.results = summary
        self.year = year
