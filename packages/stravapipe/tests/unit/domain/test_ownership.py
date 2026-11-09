"""Application ownership is explicit and never inferred from provider IDs."""

from dataclasses import FrozenInstanceError

import pytest

from stravapipe.domain.ownership import ActivityOwner, ActivityOwnershipError


@pytest.mark.parametrize("uid", ["opaque-uid", "999"])
def test_owner_is_immutable_and_namespaces_are_independent(uid):
    owner = ActivityOwner(uid, "222")
    owner.validate_activity(123, 222, expected_id=123)
    with pytest.raises(FrozenInstanceError):
        owner.uid = "changed"  # type: ignore[misc]


@pytest.mark.parametrize("uid", ["", ".", "..", "a/b", "a\nb", "x" * 129])
def test_invalid_uid(uid):
    with pytest.raises(ActivityOwnershipError):
        ActivityOwner(uid, "222")


@pytest.mark.parametrize(
    "subject", ["", "0", "01", "-1", "\uff11", "9223372036854775808"]
)
def test_invalid_subject(subject):
    with pytest.raises(ActivityOwnershipError):
        ActivityOwner("opaque", subject)


@pytest.mark.parametrize(
    ("activity_id", "subject", "expected"),
    [
        (1, 333, 1),
        (1, 222, 2),
        (0, 222, 0),
        (-1, 222, 1),
        (True, 222, 1),
        (2**63, 222, 1),
    ],
)
def test_payload_must_match_owner_and_event(activity_id, subject, expected):
    with pytest.raises(ActivityOwnershipError):
        ActivityOwner("opaque", "222").validate_activity(
            activity_id, subject, expected_id=expected
        )
