"""Firestore-backed per-user Strava token store.

Ported from Go: packages/dispatcher/adapters/firestore/token_store.go

This Python store only reads and deletes tokens; the Go dispatcher owns token
refresh/writes, so there is no write path here.

Reads and deletes Strava OAuth tokens stored at:
    users/{athleteID}/private/strava_tokens

Document schema (shared with Go dispatcher and apigateway):
    access_token: str
    refresh_token: str
    expires_at: int (Unix timestamp)
    scopes: str
    connected_at: datetime
    last_refreshed: datetime
"""

from dataclasses import dataclass
from datetime import datetime
import logging

from google.cloud.firestore_v1 import Client as FirestoreClient
from google.cloud.firestore_v1.base_document import DocumentSnapshot
from google.cloud.firestore_v1.document import DocumentReference

from stravapipe.exceptions import StravaPipeError

logger = logging.getLogger(__name__)

# Firestore path constants — must match Go shared/stravatoken/types.go
USERS_COLLECTION = "users"
PRIVATE_COLLECTION = "private"
TOKENS_DOCUMENT = "strava_tokens"


class TokenNotFoundError(StravaPipeError):
    """Raised when no tokens exist for an athlete in Firestore."""

    def __init__(self, athlete_id: str):
        super().__init__(f"No tokens found for athlete {athlete_id}")
        self.athlete_id = athlete_id


@dataclass
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
    def from_doc(cls, doc: DocumentSnapshot) -> "TokenData":
        """Parse a Firestore document into TokenData."""
        data = doc.to_dict()
        if data is None:
            raise ValueError("Document has no data")
        return cls(
            access_token=data["access_token"],
            refresh_token=data["refresh_token"],
            expires_at=data["expires_at"],
            scopes=data.get("scopes", ""),
            connected_at=data["connected_at"],
            last_refreshed=data["last_refreshed"],
        )


class FirestoreTokenStore:
    """Reads and writes per-user Strava tokens from Firestore.

    Usage:
        store = FirestoreTokenStore(firestore_client)
        tokens = store.get_tokens("12345")
        # tokens.access_token, tokens.refresh_token, etc.
    """

    def __init__(self, client: FirestoreClient):
        self._client = client

    def get_tokens(self, athlete_id: str) -> TokenData:
        """Read Strava tokens for the given athlete.

        Args:
            athlete_id: Strava athlete ID (string)

        Returns:
            TokenData with access_token, refresh_token, etc.

        Raises:
            TokenNotFoundError: If no tokens exist for this athlete.
        """
        doc = self._tokens_ref(athlete_id).get()
        if not doc.exists:
            raise TokenNotFoundError(athlete_id)

        tokens = TokenData.from_doc(doc)
        logger.info(
            "Loaded tokens for athlete %s from Firestore",
            athlete_id,
        )
        return tokens

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

    def _tokens_ref(self, athlete_id: str) -> DocumentReference:
        """Build Firestore document reference for an athlete's tokens."""
        # firestore_v1 chained access loses its typed return; cast at boundary.
        ref: DocumentReference = (
            self._client.collection(USERS_COLLECTION)
            .document(athlete_id)
            .collection(PRIVATE_COLLECTION)
            .document(TOKENS_DOCUMENT)
        )
        return ref
