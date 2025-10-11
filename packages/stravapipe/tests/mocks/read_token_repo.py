from stravapipe.domain import StravaTokenSet
from stravapipe.ports.out.read import ReadStravaToken


class MockStravaTokenRepo(ReadStravaToken):
    def __init__(self, token: StravaTokenSet):
        self.token = token

    def refresh(self):
        return self.token
