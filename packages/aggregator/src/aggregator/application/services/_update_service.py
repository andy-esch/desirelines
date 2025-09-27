from aggregator.domain import StravaActivity


class UpdateService:
    """Update summary statistics to included latest event"""

    def __init__(self):
        pass

    def update(self, summary: dict[str, dict[str, float]], activity: StravaActivity):
        pass
