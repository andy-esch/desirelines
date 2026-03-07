"""Firestore-backed per-user Strava token store.

Ported from Go: packages/dispatcher/adapters/firestore/token_store.go

Reads and writes Strava OAuth tokens stored at:
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
from datetime import UTC, datetime
import logging

from google.cloud.firestore_v1 import Client as FirestoreClient
from google.cloud.firestore_v1.base_document import DocumentSnapshot
from google.cloud.firestore_v1.transaction import transactional

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

    def write_tokens_if_unmodified(
        self,
        athlete_id: str,
        tokens: TokenData,
        expected_last_refreshed: datetime,
    ) -> bool:
        """Atomically write tokens only if last_refreshed matches expected value.

        Uses a Firestore transaction for optimistic concurrency — if another
        process refreshed tokens since we read them, the write is rejected.

        Args:
            athlete_id: Strava athlete ID
            tokens: New token data to write
            expected_last_refreshed: The last_refreshed value we read earlier

        Returns:
            True if written successfully, False if conflict detected.
        """
        ref = self._tokens_ref(athlete_id)
        now = datetime.now(tz=UTC)

        @transactional
        def update_in_transaction(transaction):
            snapshot = ref.get(transaction=transaction)
            if not snapshot.exists:
                raise TokenNotFoundError(athlete_id)

            current = TokenData.from_doc(snapshot)
            if current.last_refreshed != expected_last_refreshed:
                return False  # Conflict — another process already refreshed

            transaction.update(
                ref,
                {
                    "access_token": tokens.access_token,
                    "refresh_token": tokens.refresh_token,
                    "expires_at": tokens.expires_at,
                    "last_refreshed": now,
                },
            )
            return True

        try:
            txn = self._client.transaction()
            result = update_in_transaction(txn)
            if result:
                logger.info(
                    "Updated tokens for athlete %s in Firestore",
                    athlete_id,
                )
            else:
                logger.warning(
                    "Token write conflict for athlete %s — another process refreshed first",
                    athlete_id,
                )
            return result
        except TokenNotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to write tokens for athlete %s: %s",
                athlete_id,
                e,
            )
            raise

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

    def _tokens_ref(self, athlete_id: str):
        """Build Firestore document reference for an athlete's tokens."""
        return (
            self._client.collection(USERS_COLLECTION)
            .document(athlete_id)
            .collection(PRIVATE_COLLECTION)
            .document(TOKENS_DOCUMENT)
        )
