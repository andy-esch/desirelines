"""Server-owned registry contract shared with Go's activityconnection package."""

from dataclasses import dataclass, fields
from typing import Any
from unicodedata import category

from google.cloud.firestore_v1 import Client, Transaction, transactional

LOOKUPS_COLLECTION = "provider_accounts"
CONNECTIONS_COLLECTION = "connections"
PROVIDER = "strava"
MAX_UID_LENGTH = 128
MAX_STRAVA_SUBJECT_LENGTH = 19
MAX_STRAVA_ID = 2**63 - 1


def lookup_key(subject: str) -> str:
    """Reject ambiguous or path-shaped Strava subjects."""
    if (
        not isinstance(subject, str)
        or not subject.isascii()
        or not subject.isdecimal()
        or subject.startswith("0")
        or len(subject) > MAX_STRAVA_SUBJECT_LENGTH
        or int(subject) > MAX_STRAVA_ID
    ):
        raise ValueError("Strava subject must be a canonical positive int64")
    return f"{PROVIDER}:{subject}"


@dataclass(frozen=True)
class ConnectionRecord:
    schema_version: int
    uid: str
    provider: str
    subject: str
    scopes: list[str]
    status: str
    provenance: str
    bootstrap_id: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConnectionRecord":
        """Fail closed on missing, unknown or malformed fields."""
        if set(data) != {field.name for field in fields(cls)}:
            raise ValueError("unexpected connection fields")
        if any(
            not isinstance(data[name], str)
            for name in ("provider", "status", "provenance", "bootstrap_id")
        ):
            raise ValueError("invalid connection string fields")
        record = cls(**data)
        lookup_key(record.subject)
        if (
            not isinstance(record.uid, str)
            or not 1 <= len(record.uid) <= MAX_UID_LENGTH
            or record.uid in {".", ".."}
            or "/" in record.uid
            or any(category(c) == "Cc" for c in record.uid)
            or type(record.schema_version) is not int
            or record.schema_version != 1
            or record.provider != PROVIDER
            or record.status not in {"active", "disconnected"}
            or record.provenance not in {"legacy_uid", "oauth", "dev_fixture"}
            or not isinstance(record.scopes, list)
            or any(
                not isinstance(s, str) or not s or s.strip() != s for s in record.scopes
            )
            or len(record.scopes) != len(set(record.scopes))
            or not isinstance(record.bootstrap_id, str)
            or len(record.bootstrap_id.encode("utf-8")) > MAX_UID_LENGTH
            or any(c in record.bootstrap_id for c in "/\r\n")
        ):
            raise ValueError("invalid connection record")
        if record.provenance == "legacy_uid" and (
            record.uid != record.subject or not record.bootstrap_id
        ):
            raise ValueError("legacy connection requires original UID and bootstrap ID")
        return record


def delete_legacy_user_documents(client: Client, user_id: str) -> int:
    """Delete legacy user docs, admission and registry together.

    Bootstrap reads the admission in its transaction; deleting it in this same
    commit prevents a concurrent bootstrap from resurrecting the mapping. Token
    deletion is repeated here to fence a login racing the earlier token step.
    This retains legacy full-deletion semantics, not future disconnect policy.
    """
    key = lookup_key(user_id)
    user = client.collection("users").document(user_id)
    lookup = client.collection(LOOKUPS_COLLECTION).document(key)
    connection = user.collection(CONNECTIONS_COLLECTION).document(PROVIDER)

    @transactional
    def purge(transaction: Transaction) -> int:
        registry_refs = []
        for ref in (lookup, connection):
            snapshot = ref.get(transaction=transaction)
            if snapshot.exists:
                record = ConnectionRecord.from_dict(snapshot.to_dict() or {})
                if record.uid != user_id or record.subject != user_id:
                    raise ValueError(
                        "legacy deletion conflicts with registry ownership"
                    )
                registry_refs.append(ref)
        refs = [
            user.collection("private").document("profile"),
            user.collection("private").document("strava_tokens"),
            user.collection("config").document("v1"),
            client.collection("allowlist").document(user_id),
            *registry_refs,
        ]
        for ref in refs:
            transaction.delete(ref)
        return len(refs)

    return int(purge(client.transaction()))
