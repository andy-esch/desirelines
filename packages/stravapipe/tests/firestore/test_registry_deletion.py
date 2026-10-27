"""Real emulator tests of legacy deletion against concurrent bootstrap writes."""

from concurrent.futures import ThreadPoolExecutor

from google.cloud.firestore_v1 import Client, Transaction, transactional
import pytest

from stravapipe.adapters.firestore.activity_connection import (
    delete_legacy_user_documents,
)


def seed(client: Client, uid: str) -> dict:
    record = {
        "schema_version": 1,
        "uid": uid,
        "provider": "strava",
        "subject": uid,
        "scopes": [],
        "status": "active",
        "provenance": "legacy_uid",
        "bootstrap_id": "test",
    }
    client.document(f"allowlist/{uid}").set({})
    client.document(f"users/{uid}/private/strava_tokens").set({"canary": "private"})
    client.document(f"users/{uid}/private/profile").set({"strava_athlete_id": int(uid)})
    client.document(f"users/{uid}/config/v1").set({"canary": "config"})
    client.document(f"provider_accounts/strava:{uid}").set(record)
    client.document(f"users/{uid}/connections/strava").set(record)
    return record


def test_deletion_is_idempotent_and_preserves_other_owner(client: Client) -> None:
    seed(client, "111")
    other = seed(client, "222")
    assert delete_legacy_user_documents(client, "111") == 6
    assert delete_legacy_user_documents(client, "111") == 4
    for path in (
        "allowlist/111",
        "provider_accounts/strava:111",
        "users/111/connections/strava",
        "users/111/private/strava_tokens",
        "users/111/private/profile",
        "users/111/config/v1",
    ):
        assert not client.document(path).get().exists
    assert client.document("provider_accounts/strava:222").get().to_dict() == other
    assert client.document("users/222/private/strava_tokens").get().to_dict() == {
        "canary": "private"
    }


def test_conflict_aborts_all_firestore_deletes_and_can_retry(client: Client) -> None:
    record = seed(client, "111")
    lookup = client.document("provider_accounts/strava:111")
    lookup.update({"uid": "other", "provenance": "oauth"})
    with pytest.raises(ValueError, match="conflicts with registry ownership"):
        delete_legacy_user_documents(client, "111")
    assert client.document("allowlist/111").get().exists
    assert client.document("users/111/private/strava_tokens").get().exists
    lookup.set(record)
    assert delete_legacy_user_documents(client, "111") == 6


def test_bootstrap_racing_deletion_cannot_resurrect_mapping(client: Client) -> None:
    for value in range(111, 116):
        uid = str(value)
        record = seed(client, uid)

        @transactional
        def bootstrap(tx: Transaction, subject: str, entry: dict) -> None:
            if not client.document(f"allowlist/{subject}").get(transaction=tx).exists:
                return
            tx.set(client.document(f"provider_accounts/strava:{subject}"), entry)
            tx.set(client.document(f"users/{subject}/connections/strava"), entry)

        with ThreadPoolExecutor(max_workers=2) as pool:
            apply = pool.submit(bootstrap, client.transaction(), uid, record)
            purge = pool.submit(delete_legacy_user_documents, client, uid)
            apply.result(timeout=30)
            purge.result(timeout=30)
        assert not client.document(f"allowlist/{uid}").get().exists
        assert not client.document(f"provider_accounts/strava:{uid}").get().exists
        assert not client.document(f"users/{uid}/connections/strava").get().exists
