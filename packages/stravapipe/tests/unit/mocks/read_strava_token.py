from stravapipe.domain import StravaTokenSet
from stravapipe.ports.out.read import ReadStravaToken


class MockReadStravaToken(ReadStravaToken):
    def __init__(self, tokenset: StravaTokenSet):
        self.tokenset = tokenset

    def refresh(self) -> StravaTokenSet:
        return self.tokenset
