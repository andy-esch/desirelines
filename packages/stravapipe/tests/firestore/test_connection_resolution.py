"""Real SDK ownership reads shared with Go's activityconnection.Store."""

import json
from pathlib import Path

from google.cloud.firestore_v1 import Client, Transaction, transactional
import pytest

from stravapipe.adapters.firestore.activity_connection import (
    ConnectionConflictError,
    ConnectionNotFoundError,
    ConnectionRecord,
    ConnectionResolver,
)

FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "schemas/test-fixtures/activity_connection.json"
)


def seed(client: Client, record: dict) -> None:
    client.document(f"provider_accounts/strava:{record['subject']}").set(record)
    client.document(f"users/{record['uid']}/connections/strava").set(record)


def test_shared_fixture_and_equal_looking_namespaces(client: Client) -> None:
    record = json.loads(FIXTURE.read_text())
    seed(client, record)
    other = record | {"uid": record["subject"], "subject": "333"}
    seed(client, other)
    resolver = ConnectionResolver(client)
    assert resolver.resolve(record["subject"]) == ConnectionRecord.from_dict(record)
    assert resolver.resolve("333") == ConnectionRecord.from_dict(other)
    with pytest.raises(ConnectionNotFoundError):
        resolver.resolve("999")


@pytest.mark.parametrize(
    ("side", "change", "error"),
    [
        ("lookup", None, ConnectionNotFoundError),
        ("connection", None, ConnectionConflictError),
        ("lookup", {"status": "disconnected"}, ConnectionNotFoundError),
        ("connection", {"status": "disconnected"}, ConnectionConflictError),
        ("connection", {"scopes": ["read"]}, ConnectionConflictError),
        ("lookup", {"schema_version": True}, ConnectionConflictError),
        ("connection", {"scopes": None}, ConnectionConflictError),
        ("lookup", {"uid": None}, ConnectionConflictError),
        ("both", {"subject": "333"}, ConnectionConflictError),
    ],
)
def test_refuses_bad_pairs_without_changes(
    client: Client, side: str, change: dict | None, error: type[Exception]
) -> None:
    record = json.loads(FIXTURE.read_text())
    seed(client, record)
    refs = {
        "lookup": client.document(f"provider_accounts/strava:{record['subject']}"),
        "connection": client.document(f"users/{record['uid']}/connections/strava"),
    }
    if change is None:
        refs[side].delete()
    else:
        for ref in refs.values() if side == "both" else [refs[side]]:
            ref.update(change)
    before = {name: ref.get().to_dict() for name, ref in refs.items()}
    with pytest.raises(error):
        ConnectionResolver(client).resolve(record["subject"])
    assert {name: ref.get().to_dict() for name, ref in refs.items()} == before


def test_composes_with_credential_transaction(client: Client) -> None:
    record = json.loads(FIXTURE.read_text())
    seed(client, record)
    right = client.document(f"users/{record['uid']}/private/strava_tokens")
    wrong = client.document(f"users/{record['subject']}/private/strava_tokens")
    right.set({"access_token": "resolved-user-canary"})
    wrong.set({"access_token": "equal-looking-uid-canary"})
    resolver = ConnectionResolver(client)

    @transactional
    def read_and_write(transaction: Transaction) -> str:
        resolved = resolver.resolve_in_transaction(transaction, record["subject"])
        data = client.document(f"users/{resolved.uid}/private/strava_tokens").get(
            transaction=transaction
        )
        transaction.set(client.document("test_results/resolved"), {"uid": resolved.uid})
        credentials = data.to_dict()
        assert credentials is not None
        return credentials["access_token"]

    assert read_and_write(client.transaction()) == "resolved-user-canary"
    assert client.document("test_results/resolved").get().to_dict() == {
        "uid": record["uid"]
    }


def test_uses_callers_read_snapshot(client: Client) -> None:
    record = json.loads(FIXTURE.read_text())
    seed(client, record)
    lookup = client.document(f"provider_accounts/strava:{record['subject']}")
    connection = client.document(f"users/{record['uid']}/connections/strava")
    resolver = ConnectionResolver(client)

    @transactional
    def read_snapshot(transaction: Transaction) -> ConnectionRecord:
        lookup.get(transaction=transaction)  # Establish this transaction's snapshot.
        inactive = record | {"status": "disconnected"}
        batch = client.batch()
        batch.set(lookup, inactive)
        batch.set(connection, inactive)
        batch.commit(timeout=5)
        return resolver.resolve_in_transaction(transaction, record["subject"])

    assert read_snapshot(client.transaction(read_only=True)).status == "active"
    with pytest.raises(ConnectionNotFoundError):
        resolver.resolve(record["subject"])
