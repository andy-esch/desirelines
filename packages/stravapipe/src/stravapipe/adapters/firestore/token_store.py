"""Firestore-backed per-user Strava token store.

Ported from Go: packages/dispatcher/adapters/firestore/token_store.go

Reads and conditional refresh writes use the resolved app UID and revalidate
the original UID/subject pair in each transaction attempt. External OAuth stays
outside transactions. The legacy full-deletion path is migrated separately.

Token path: users/{uid}/private/strava_tokens

Document schema (shared with Go dispatcher and apigateway):
    access_token: str
    refresh_token: str
    expires_at: int (Unix timestamp)
    scopes: str
    connected_at: datetime
    last_refreshed: datetime
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
import logging
from typing import cast

from google.cloud.firestore_v1 import Client as FirestoreClient
from google.cloud.firestore_v1 import Transaction, transactional
from google.cloud.firestore_v1.base_document import DocumentSnapshot
from google.cloud.firestore_v1.document import DocumentReference

from stravapipe.adapters.firestore.activity_connection import (
    ConnectionConflictError,
    ConnectionRecord,
    ConnectionResolver,
)
from stravapipe.domain import StravaTokenSet
from stravapipe.exceptions import StravaPipeError

logger = logging.getLogger(__name__)

# Firestore path constants — must match Go shared/stravatoken/types.go
USERS_COLLECTION = "users"
PRIVATE_COLLECTION = "private"
TOKENS_DOCUMENT = "strava_tokens"

# Fields a caller cannot function without. Kept in step with Go's
# stravatoken.Data.Validate — if one side changes, the shared fixture parity
# tests are what should catch it.
_REQUIRED_FIELDS = ("access_token", "refresh_token", "expires_at")
_ZERO_TIME = datetime.min.replace(tzinfo=UTC)


class TokenConflictError(StravaPipeError):
    """Credentials changed after the refresh input was read."""


class IncompleteTokenDataError(StravaPipeError):
    """Raised when a strava_tokens document is missing a field callers need.

    Mirrors Go's ``stravatoken.ErrIncompleteTokens`` so the same corrupt
    document is rejected, and described the same way, on both language edges.
    Replaces a bare ``KeyError`` whose message was just the field name, with no
    app UID or document context.
    """

    def __init__(self, uid: str | None, missing: Sequence[str]):
        who = f" for app UID {uid}" if uid else ""
        super().__init__(
            f"incomplete strava_tokens document{who}: missing {sorted(missing)}"
        )
        self.uid = uid
        self.missing = sorted(missing)


class TokenNotFoundError(StravaPipeError):
    """Raised when no tokens exist for an app UID in Firestore."""

    def __init__(self, uid: str):
        super().__init__(f"No tokens found for app UID {uid}")
        self.uid = uid


@dataclass(frozen=True)
class TokenData:
    """Strava token data from Firestore.

    Matches the Go struct stravatoken.Data and the Firestore document schema.
    """

    access_token: str
    refresh_token: str
    expires_at: int
    scopes: str
    connected_at: datetime
    last_refreshed: datetime

    @classmethod
    def from_doc(cls, doc: DocumentSnapshot, *, uid: str | None = None) -> "TokenData":
        """Parse a Firestore document into TokenData.

        Rejects a document missing any field needed to talk to Strava. The
        required set and its emptiness semantics match Go's
        ``stravatoken.Data.Validate``: absent *and* empty both fail, because
        Firestore's Go decoder cannot tell them apart and a zero-filled
        credential is unusable either way.

        ``scopes``, ``connected_at`` and ``last_refreshed`` stay optional on
        purpose — see that method's doc comment for why.

        Raises:
            IncompleteTokenDataError: If a required field is absent or empty.
        """
        data = doc.to_dict()
        if data is None:
            raise IncompleteTokenDataError(uid, _REQUIRED_FIELDS)

        missing = [f for f in _REQUIRED_FIELDS if not data.get(f)]
        missing.extend(
            f
            for f in _REQUIRED_FIELDS
            if f not in missing
            and type(data[f]) is not (int if f == "expires_at" else str)
        )
        if missing:
            raise IncompleteTokenDataError(uid, missing)

        return cls(
            access_token=data["access_token"],
            refresh_token=data["refresh_token"],
            expires_at=data["expires_at"],
            scopes=data.get("scopes", ""),
            connected_at=data.get("connected_at", _ZERO_TIME),
            last_refreshed=data.get("last_refreshed", _ZERO_TIME),
        )


class FirestoreTokenStore:
    """Owner-bound reads/refresh writes, plus legacy full-deletion cleanup."""

    def __init__(self, client: FirestoreClient):
        self._client = client
        self._resolver = ConnectionResolver(client)

    def get_tokens(self, owner: ConnectionRecord) -> TokenData:
        """Read registry and credentials in one snapshot without retargeting."""

        @transactional
        def read(transaction: Transaction) -> TokenData:
            self._check_owner(transaction, owner)
            return self._read_tokens(transaction, owner.uid)

        return cast(TokenData, read(self._client.transaction()))

    def write_tokens_if_unmodified(
        self,
        owner: ConnectionRecord,
        refreshed: StravaTokenSet,
        expected: TokenData,
    ) -> TokenData:
        """Persist rotation without recreating deleted or overwriting newer tokens.

        last_refreshed is the shared Go/Python compare-and-swap version. Only
        refresh fields change; OAuth scopes and connected_at remain untouched.
        """
        if (
            not refreshed.access_token
            or not refreshed.refresh_token
            or not refreshed.expires_at
        ):
            raise IncompleteTokenDataError(owner.uid, _REQUIRED_FIELDS)
        now = max(
            datetime.now(UTC), expected.last_refreshed + timedelta(microseconds=1)
        )

        @transactional
        def write(transaction: Transaction) -> TokenData:
            self._check_owner(transaction, owner)
            current = self._read_tokens(transaction, owner.uid)
            if current.last_refreshed != expected.last_refreshed:
                raise TokenConflictError("Strava credentials changed during refresh")
            updates = {
                "access_token": refreshed.access_token,
                "refresh_token": refreshed.refresh_token,
                "expires_at": refreshed.expires_at,
                "last_refreshed": now,
            }
            transaction.update(self._tokens_ref(owner.uid), updates)
            return replace(
                current,
                access_token=refreshed.access_token,
                refresh_token=refreshed.refresh_token,
                expires_at=refreshed.expires_at,
                last_refreshed=now,
            )

        return cast(TokenData, write(self._client.transaction()))

    def _check_owner(self, transaction: Transaction, owner: ConnectionRecord) -> None:
        current = self._resolver.resolve_in_transaction(transaction, owner.subject)
        if current.uid != owner.uid:
            raise ConnectionConflictError("activity connection ownership changed")

    def _read_tokens(self, transaction: Transaction, uid: str) -> TokenData:
        doc = self._tokens_ref(uid).get(transaction=transaction)
        if not doc.exists:
            raise TokenNotFoundError(uid)
        return TokenData.from_doc(doc, uid=uid)

    def delete_tokens(self, athlete_id: str) -> None:
        """Delete Strava tokens for the given athlete.

        Idempotent — deleting a non-existent document is a no-op in Firestore.

        Args:
            athlete_id: Strava athlete ID (string)
        """
        self._tokens_ref(athlete_id).delete()
        logger.info(
            "Deleted tokens for athlete %s from Firestore",
            athlete_id,
        )

    def _tokens_ref(self, uid: str) -> DocumentReference:
        """Build the credential path for an explicit app UID."""
        # firestore_v1 chained access loses its typed return; cast at boundary.
        ref: DocumentReference = (
            self._client.collection(USERS_COLLECTION)
            .document(uid)
            .collection(PRIVATE_COLLECTION)
            .document(TOKENS_DOCUMENT)
        )
        return ref
