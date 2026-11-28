"""Server-owned registry contract shared with Go's activityconnection package."""

from dataclasses import dataclass, fields
import re
from typing import Any, cast
from unicodedata import category

from google.cloud.firestore_v1 import Client, Transaction, transactional
from google.cloud.firestore_v1.document import DocumentReference

from stravapipe.exceptions import StravaPipeError

LOOKUPS_COLLECTION = "provider_accounts"
CONNECTIONS_COLLECTION = "connections"
PROVIDER = "strava"
MAX_UID_LENGTH = 128
MAX_STRAVA_SUBJECT_LENGTH = 19
MAX_STRAVA_ID = 2**63 - 1


def validate_uid(uid: str) -> None:
    """Validate an opaque Firebase UID used as a Firestore document key."""
    if (
        not isinstance(uid, str)
        or not 1 <= len(uid) <= MAX_UID_LENGTH
        or uid in {".", ".."}
        or "/" in uid
        or any(category(c) in {"Cc", "Cs"} for c in uid)
    ):
        raise ValueError("invalid Firebase UID document key")


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
        validate_uid(record.uid)
        if (
            type(record.schema_version) is not int
            or record.schema_version != 1
            or record.provider != PROVIDER
            or record.status not in {"active", "disconnected"}
            or record.provenance not in {"legacy_uid", "oauth", "dev_fixture"}
            or not isinstance(record.scopes, list)
            or any(
                not isinstance(s, str) or re.fullmatch(r"[a-z0-9_:]+", s) is None
                for s in record.scopes
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


class ConnectionNotFoundError(StravaPipeError):
    """No active lookup exists for this provider subject."""


class ConnectionConflictError(StravaPipeError):
    """The persisted ownership pair is incomplete, malformed or inconsistent."""


def _decode_record(data: dict[str, Any]) -> ConnectionRecord:
    try:
        return ConnectionRecord.from_dict(data)
    except (TypeError, ValueError) as exc:
        raise ConnectionConflictError("malformed activity connection") from exc


class ConnectionResolver:
    """Read server-owned Strava ownership without inferring a UID from a subject."""

    def __init__(self, client: Client):
        self._client = client

    def resolve(self, subject: str) -> ConnectionRecord:
        """Read both active records in one transaction; never read credentials."""
        lookup_key(subject)  # Reject invalid subjects before creating a transaction.
        read = transactional(self.resolve_in_transaction)
        return cast(
            ConnectionRecord, read(self._client.transaction(read_only=True), subject)
        )

    def resolve_in_transaction(
        self, transaction: Transaction, subject: str
    ) -> ConnectionRecord:
        """Use the caller's snapshot, including subsequent credential reads.

        Finish all reads before scheduling writes; OAuth/Auth calls must remain
        outside retryable transaction callbacks.
        """
        lookup = self._client.collection(LOOKUPS_COLLECTION).document(
            lookup_key(subject)
        )
        snapshot = lookup.get(transaction=transaction)
        if not snapshot.exists:
            raise ConnectionNotFoundError("active activity connection not found")
        record = _decode_record(snapshot.to_dict() or {})
        if record.status != "active":
            raise ConnectionNotFoundError("active activity connection not found")
        connection = (
            self._client.collection("users")
            .document(record.uid)
            .collection(CONNECTIONS_COLLECTION)
            .document(PROVIDER)
        ).get(transaction=transaction)
        if (
            not connection.exists
            or _decode_record(connection.to_dict() or {}) != record
            or record.subject != subject
        ):
            raise ConnectionConflictError("activity connection ownership conflict")
        return record


def _owned_registry_refs(
    transaction: Transaction,
    client: Client,
    uid: str,
    subject: str,
) -> list[DocumentReference]:
    lookup = client.collection(LOOKUPS_COLLECTION).document(lookup_key(subject))
    connection = client.document(f"users/{uid}/{CONNECTIONS_COLLECTION}/{PROVIDER}")
    refs = []
    matched: ConnectionRecord | None = None
    for ref in (lookup, connection):
        snapshot = ref.get(transaction=transaction)
        if snapshot.exists:
            record = _decode_record(snapshot.to_dict() or {})
            if (record.uid, record.subject) != (uid, subject) or (
                matched is not None and record != matched
            ):
                raise ConnectionConflictError(
                    "deletion conflicts with registry ownership"
                )
            matched = record
            refs.append(ref)
    return refs


def verify_deletion_owner(client: Client, uid: str, subject: str) -> None:
    """Check for a conflicting owner before starting cross-store cleanup."""
    validate_uid(uid)
    check = transactional(_owned_registry_refs)
    check(client.transaction(read_only=True), client, uid, subject)


def delete_user_documents(client: Client, uid: str, subject: str) -> int:
    """Purge app documents and matching registry records in one transaction.

    Admission is deleted in the same commit to fence concurrent bootstrap.
    An absent record is expected on retries after a successful Firestore purge.
    """
    validate_uid(uid)
    user = client.collection("users").document(uid)

    @transactional
    def purge(transaction: Transaction) -> int:
        registry_refs = _owned_registry_refs(transaction, client, uid, subject)
        refs = [
            user.collection("private").document("profile"),
            user.collection("private").document("strava_tokens"),
            user.collection("config").document("v1"),
            client.collection("allowlist").document(uid),
            *registry_refs,
        ]
        for ref in refs:
            transaction.delete(ref)
        return len(refs)

    return int(purge(client.transaction()))
