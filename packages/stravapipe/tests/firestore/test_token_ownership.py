"""Owner-bound credentials exercised through real Firestore SDK transactions."""

from datetime import UTC, datetime
from unittest.mock import patch

from google.api_core.exceptions import Aborted
from google.cloud.firestore_v1 import Client, Transaction
import pytest

from stravapipe.adapters.firestore.activity_connection import (
    ConnectionConflictError,
    ConnectionNotFoundError,
    ConnectionRecord,
)
from stravapipe.adapters.firestore.token_store import (
    FirestoreTokenStore,
    TokenConflictError,
    TokenNotFoundError,
)
from stravapipe.domain import StravaTokenSet


def seed(
    client: Client, uid: str = "app-alpha", subject: str = "222"
) -> ConnectionRecord:
    data = {
        "schema_version": 1,
        "uid": uid,
        "provider": "strava",
        "subject": subject,
        "scopes": [],
        "status": "active",
        "provenance": "oauth",
        "bootstrap_id": "",
    }
    client.document(f"provider_accounts/strava:{subject}").set(data)
    client.document(f"users/{uid}/connections/strava").set(data)
    client.document(f"users/{uid}/private/strava_tokens").set(
        {
            "access_token": "original-access",
            "refresh_token": "original-refresh",
            "expires_at": 2000000000,
            "scopes": "read",
            "connected_at": datetime(2026, 1, 1, tzinfo=UTC),
        }
    )
    return ConnectionRecord.from_dict(data)


def rotated() -> StravaTokenSet:
    return StravaTokenSet(
        1, "fake-secret", "rotated-access", "rotated-refresh", 2100000000
    )


@pytest.mark.parametrize("uid", ["app-alpha", "333"])
def test_read_and_rotation_use_uid_not_equal_looking_subject(
    client: Client, uid: str
) -> None:
    owner = seed(client, uid)
    seed(client, "222", "444")
    wrong = client.document("users/222/private/strava_tokens")
    wrong.update({"access_token": "other-owner-canary"})
    wrong_before = wrong.get().to_dict()
    store = FirestoreTokenStore(client)
    original = store.get_tokens(owner)
    assert original.access_token == "original-access"
    assert original.last_refreshed == datetime.min.replace(tzinfo=UTC)
    written = store.write_tokens_if_unmodified(owner, rotated(), original)
    assert written.refresh_token == "rotated-refresh"
    assert written.scopes == original.scopes
    assert written.connected_at == original.connected_at
    assert written.last_refreshed > original.last_refreshed
    assert store.get_tokens(owner) == written
    assert wrong.get().to_dict() == wrong_before
    with pytest.raises(TokenConflictError):
        store.write_tokens_if_unmodified(owner, rotated(), original)
    assert store.get_tokens(owner) == written


@pytest.mark.parametrize(
    "change",
    [
        "remap",
        "disconnect",
        "missing-lookup",
        "missing-connection",
        "tokens-deleted",
        "newer-tokens",
    ],
)
def test_captured_owner_and_version_never_retarget_or_recreate(
    client: Client, change: str
) -> None:
    owner = seed(client)
    store = FirestoreTokenStore(client)
    original = store.get_tokens(owner)
    tokens = client.document(f"users/{owner.uid}/private/strava_tokens")
    error: type[Exception]
    if change == "remap":
        seed(client, "new-owner")
        error = ConnectionConflictError
    elif change == "disconnect":
        client.document("provider_accounts/strava:222").update(
            {"status": "disconnected"}
        )
        error = ConnectionNotFoundError
    elif change == "missing-lookup":
        client.document("provider_accounts/strava:222").delete()
        error = ConnectionNotFoundError
    elif change == "missing-connection":
        client.document(f"users/{owner.uid}/connections/strava").delete()
        error = ConnectionConflictError
    elif change == "tokens-deleted":
        tokens.delete()
        error = TokenNotFoundError
    else:
        tokens.update(
            {
                "last_refreshed": datetime(2026, 10, 1, tzinfo=UTC),
                "access_token": "concurrent-canary",
            }
        )
        error = TokenConflictError
    before = tokens.get().to_dict()
    with pytest.raises(error):
        store.write_tokens_if_unmodified(owner, rotated(), original)
    assert tokens.get().to_dict() == before
    if change in {"remap", "disconnect", "missing-lookup", "missing-connection"}:
        with pytest.raises(error):
            store.get_tokens(owner)
    if change == "remap":
        new_owner_tokens = (
            client.document("users/new-owner/private/strava_tokens").get().to_dict()
        )
        assert new_owner_tokens is not None
        assert new_owner_tokens["access_token"] == "original-access"


@pytest.mark.parametrize(
    "change",
    ["remap", "tokens-deleted", "newer-tokens", "optional-fields-removed", "none"],
)
def test_sdk_retry_revalidates_binding_and_version(client: Client, change: str) -> None:
    owner = seed(client)
    store = FirestoreTokenStore(client)
    original = store.get_tokens(owner)
    tokens = client.document(f"users/{owner.uid}/private/strava_tokens")
    original_commit = Transaction._commit
    attempts = 0

    def commit(transaction: Transaction):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            # Abort the real first transaction before mutating outside it.
            transaction._rollback()
            if change == "remap":
                seed(client, "new-owner")
            elif change == "tokens-deleted":
                tokens.delete()
            elif change == "newer-tokens":
                tokens.update({"last_refreshed": datetime(2026, 10, 1, tzinfo=UTC)})
            elif change == "optional-fields-removed":
                tokens.set(
                    {
                        "access_token": original.access_token,
                        "refresh_token": original.refresh_token,
                        "expires_at": original.expires_at,
                    }
                )
            raise Aborted("injected retry after rollback")
        return original_commit(transaction)

    errors = {
        "remap": ConnectionConflictError,
        "tokens-deleted": TokenNotFoundError,
        "newer-tokens": TokenConflictError,
    }
    with patch.object(Transaction, "_commit", commit):
        if change in errors:
            with pytest.raises(errors[change]):
                store.write_tokens_if_unmodified(owner, rotated(), original)
        else:
            result = store.write_tokens_if_unmodified(owner, rotated(), original)
            assert attempts == 2
            assert result.refresh_token == "rotated-refresh"
            if change == "optional-fields-removed":
                assert result.scopes == ""
                assert result.connected_at == datetime.min.replace(tzinfo=UTC)
    assert attempts >= 1
    actual = tokens.get().to_dict()
    if change == "tokens-deleted":
        assert actual is None
    elif change in errors:
        assert actual is not None
        assert actual["access_token"] == "original-access"


def test_missing_or_incomplete_credentials_never_recreated(client: Client) -> None:
    from stravapipe.adapters.firestore.token_store import IncompleteTokenDataError

    owner = seed(client)
    store = FirestoreTokenStore(client)
    tokens = client.document(f"users/{owner.uid}/private/strava_tokens")
    original = store.get_tokens(owner)
    with pytest.raises(IncompleteTokenDataError):
        store.write_tokens_if_unmodified(
            owner, StravaTokenSet(1, "secret", "", "refresh", 2000000000), original
        )
    assert store.get_tokens(owner) == original
    tokens.delete()
    with pytest.raises(TokenNotFoundError):
        store.get_tokens(owner)
    tokens.set({"access_token": "partial"})
    with pytest.raises(IncompleteTokenDataError):
        store.get_tokens(owner)
    assert tokens.get().to_dict() == {"access_token": "partial"}
