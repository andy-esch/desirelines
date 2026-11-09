"""Trusted application ownership, kept outside provider activity payloads."""

from dataclasses import dataclass
from unicodedata import category

from stravapipe.exceptions import StravaPipeError


class ActivityOwnershipError(StravaPipeError):
    """Missing, changed or conflicting ownership; retry rather than guess."""


MAX_UID_LENGTH = 128
MAX_SUBJECT_LENGTH = 19


@dataclass(frozen=True)
class ActivityOwner:
    uid: str
    subject: str

    def __post_init__(self) -> None:
        if (
            not isinstance(self.uid, str)
            or not 1 <= len(self.uid) <= MAX_UID_LENGTH
            or self.uid in {".", ".."}
            or "/" in self.uid
            or any(category(c) == "Cc" for c in self.uid)
            or not isinstance(self.subject, str)
            or not self.subject.isascii()
            or not self.subject.isdecimal()
            or self.subject.startswith("0")
            or len(self.subject) > MAX_SUBJECT_LENGTH
            or int(self.subject) > 2**63 - 1
        ):
            raise ActivityOwnershipError("invalid trusted activity ownership")

    def validate_activity(
        self, activity_id: int, subject: int, *, expected_id: int | None = None
    ) -> None:
        self.validate_id(activity_id)
        self.validate_id(subject)
        if expected_id is not None:
            self.validate_id(expected_id)
        if str(subject) != self.subject or (
            expected_id is not None and activity_id != expected_id
        ):
            raise ActivityOwnershipError(
                "activity payload differs from trusted ownership/event"
            )

    @staticmethod
    def validate_id(value: int) -> None:
        if type(value) is not int or not 0 < value <= 2**63 - 1:
            raise ActivityOwnershipError(
                "activity identifiers must be positive int64 values"
            )
