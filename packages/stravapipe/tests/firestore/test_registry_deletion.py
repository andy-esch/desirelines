"""Firestore deletion tests against the emulator, including bootstrap races."""

from concurrent.futures import ThreadPoolExecutor

from google.cloud.firestore_v1 import Client, Transaction, transactional
import pytest

from stravapipe.adapters.firestore.activity_connection import (
    ConnectionConflictError,
    delete_user_documents,
    verify_deletion_owner,
)


def seed(client: Client, uid: str, subject: str) -> dict:
    record = {
        "schema_version": 1,
        "uid": uid,
        "provider": "strava",
        "subject": subject,
        "scopes": [],
        "status": "active",
        "provenance": "legacy_uid" if uid == subject else "oauth",
        "bootstrap_id": "test",
    }
    client.document(f"allowlist/{uid}").set({})
    client.document(f"users/{uid}/private/strava_tokens").set({"canary": "private"})
    client.document(f"users/{uid}/private/profile").set(
        {"strava_athlete_id": int(subject)}
    )
    client.document(f"users/{uid}/config/v1").set({"canary": "config"})
    client.document(f"provider_accounts/strava:{subject}").set(record)
    client.document(f"users/{uid}/connections/strava").set(record)
    return record


def test_deletion_is_idempotent_and_preserves_other_owner(client: Client) -> None:
    seed(client, "app-user", "111")
    other = seed(client, "111", "222")
    verify_deletion_owner(client, "app-user", "111")
    assert delete_user_documents(client, "app-user", "111") == 6
    verify_deletion_owner(client, "app-user", "111")  # Reply lost after commit.
    assert delete_user_documents(client, "app-user", "111") == 4
    for path in (
        "allowlist/app-user",
        "provider_accounts/strava:111",
        "users/app-user/connections/strava",
        "users/app-user/private/strava_tokens",
        "users/app-user/private/profile",
        "users/app-user/config/v1",
    ):
        assert not client.document(path).get().exists
    assert client.document("provider_accounts/strava:222").get().to_dict() == other
    assert client.document("users/111/private/strava_tokens").get().to_dict() == {
        "canary": "private"
    }


@pytest.mark.parametrize(
    ("path", "conflict"),
    [
        ("provider_accounts/strava:111", {"uid": "other"}),
        ("users/app-user/connections/strava", {"subject": "222"}),
        ("provider_accounts/strava:111", {"schema_version": 999}),
        ("users/app-user/connections/strava", {"status": "disconnected"}),
    ],
)
def test_conflict_aborts_all_firestore_deletes_and_can_retry(
    client: Client, path: str, conflict: dict
) -> None:
    record = seed(client, "app-user", "111")
    ref = client.document(path)
    verify_deletion_owner(client, "app-user", "111")
    ref.update(conflict)  # Change after the initial check, before purge.
    with pytest.raises(ConnectionConflictError):
        verify_deletion_owner(client, "app-user", "111")
    with pytest.raises(ConnectionConflictError):
        delete_user_documents(client, "app-user", "111")
    assert client.document("allowlist/app-user").get().exists
    assert client.document("users/app-user/private/strava_tokens").get().exists
    ref.set(record)
    assert delete_user_documents(client, "app-user", "111") == 6


def test_bootstrap_racing_deletion_cannot_resurrect_mapping(client: Client) -> None:
    for value in range(111, 116):
        uid = str(value)
        record = seed(client, uid, uid)

        @transactional
        def bootstrap(tx: Transaction, subject: str, entry: dict) -> None:
            if not client.document(f"allowlist/{subject}").get(transaction=tx).exists:
                return
            tx.set(client.document(f"provider_accounts/strava:{subject}"), entry)
            tx.set(client.document(f"users/{subject}/connections/strava"), entry)

        with ThreadPoolExecutor(max_workers=2) as pool:
            apply = pool.submit(bootstrap, client.transaction(), uid, record)
            purge = pool.submit(delete_user_documents, client, uid, uid)
            apply.result(timeout=30)
            purge.result(timeout=30)
        assert not client.document(f"allowlist/{uid}").get().exists
        assert not client.document(f"provider_accounts/strava:{uid}").get().exists
        assert not client.document(f"users/{uid}/connections/strava").get().exists
