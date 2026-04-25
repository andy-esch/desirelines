"""Unit tests for FirestoreTokenStore."""

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from stravapipe.adapters.firestore import (
    FirestoreTokenStore,
    TokenData,
    TokenNotFoundError,
)
from stravapipe.adapters.firestore.token_store import (
    PRIVATE_COLLECTION,
    TOKENS_DOCUMENT,
    USERS_COLLECTION,
)


@pytest.fixture
def mock_firestore_client():
    return MagicMock()


@pytest.fixture
def store(mock_firestore_client):
    return FirestoreTokenStore(mock_firestore_client)


def _make_doc_snapshot(data: dict | None, *, exists: bool = True) -> MagicMock:
    """Create a mock Firestore DocumentSnapshot."""
    doc = MagicMock()
    doc.exists = exists
    doc.to_dict.return_value = data
    return doc


def _sample_token_data() -> dict:
    return {
        "access_token": "access_abc",
        "refresh_token": "refresh_xyz",
        "expires_at": 1700000000,
        "scopes": "activity:read_all",
        "connected_at": datetime(2024, 1, 15, tzinfo=UTC),
        "last_refreshed": datetime(2025, 3, 1, 12, 0, 0, tzinfo=UTC),
    }


def _ref_mock(client: MagicMock) -> MagicMock:
    """Get the ref mock at the end of the collection/document chain."""
    return client.collection.return_value.document.return_value.collection.return_value.document.return_value


# ============================================================
# TokenData.from_doc
# ============================================================


class TestTokenDataFromDoc:
    def test_parses_complete_document(self):
        data = _sample_token_data()
        doc = _make_doc_snapshot(data)

        result = TokenData.from_doc(doc)

        assert result.access_token == "access_abc"
        assert result.refresh_token == "refresh_xyz"
        assert result.expires_at == 1700000000
        assert result.scopes == "activity:read_all"
        assert result.connected_at == data["connected_at"]
        assert result.last_refreshed == data["last_refreshed"]

    def test_defaults_scopes_to_empty(self):
        data = _sample_token_data()
        del data["scopes"]
        doc = _make_doc_snapshot(data)

        result = TokenData.from_doc(doc)
        assert result.scopes == ""

    def test_raises_on_none_data(self):
        doc = _make_doc_snapshot(None)
        with pytest.raises(ValueError, match="no data"):
            TokenData.from_doc(doc)


# ============================================================
# FirestoreTokenStore.get_tokens
# ============================================================


class TestGetTokens:
    def test_returns_tokens_for_existing_athlete(self, store, mock_firestore_client):
        data = _sample_token_data()
        doc = _make_doc_snapshot(data)
        _ref_mock(mock_firestore_client).get.return_value = doc

        result = store.get_tokens("12345")

        assert result.access_token == "access_abc"
        assert result.refresh_token == "refresh_xyz"

    def test_raises_token_not_found_for_missing_athlete(
        self, store, mock_firestore_client
    ):
        doc = _make_doc_snapshot(None, exists=False)
        _ref_mock(mock_firestore_client).get.return_value = doc

        with pytest.raises(TokenNotFoundError, match="12345"):
            store.get_tokens("12345")

    def test_uses_correct_firestore_path(self, store, mock_firestore_client):
        data = _sample_token_data()
        doc = _make_doc_snapshot(data)
        _ref_mock(mock_firestore_client).get.return_value = doc

        store.get_tokens("67890")

        mock_firestore_client.collection.assert_called_with(USERS_COLLECTION)
        mock_firestore_client.collection.return_value.document.assert_called_with(
            "67890"
        )
        mock_firestore_client.collection.return_value.document.return_value.collection.assert_called_with(
            PRIVATE_COLLECTION
        )
        _ref_mock(mock_firestore_client)  # final .document already asserted via chain
        mock_firestore_client.collection.return_value.document.return_value.collection.return_value.document.assert_called_with(
            TOKENS_DOCUMENT
        )


# ============================================================
# FirestoreTokenStore.write_tokens_if_unmodified
# ============================================================


class TestWriteTokensIfUnmodified:
    @patch("stravapipe.adapters.firestore.token_store.transactional")
    def test_writes_when_last_refreshed_matches(
        self, mock_transactional, store, mock_firestore_client
    ):
        expected_last_refreshed = datetime(2025, 3, 1, 12, 0, 0, tzinfo=UTC)
        current_data = _sample_token_data()
        current_data["last_refreshed"] = expected_last_refreshed

        new_tokens = TokenData(
            access_token="new_access",
            refresh_token="new_refresh",
            expires_at=1800000000,
            scopes="activity:read_all",
            connected_at=current_data["connected_at"],
            last_refreshed=expected_last_refreshed,
        )

        # Make @transactional pass through: call the wrapped fn with a mock txn
        snapshot = _make_doc_snapshot(current_data)
        _ref_mock(mock_firestore_client).get.return_value = snapshot

        def passthrough_transactional(fn):
            mock_txn_callable = MagicMock()
            mock_txn_callable.side_effect = fn
            return mock_txn_callable

        mock_transactional.side_effect = passthrough_transactional

        result = store.write_tokens_if_unmodified(
            "12345", new_tokens, expected_last_refreshed
        )
        assert result is True

    @patch("stravapipe.adapters.firestore.token_store.transactional")
    def test_rejects_on_conflict(
        self, mock_transactional, store, mock_firestore_client
    ):
        stale_last_refreshed = datetime(2025, 2, 1, tzinfo=UTC)
        current_data = _sample_token_data()
        current_data["last_refreshed"] = datetime(2025, 3, 1, 12, 0, 0, tzinfo=UTC)

        new_tokens = TokenData(
            access_token="new_access",
            refresh_token="new_refresh",
            expires_at=1800000000,
            scopes="activity:read_all",
            connected_at=current_data["connected_at"],
            last_refreshed=stale_last_refreshed,
        )

        snapshot = _make_doc_snapshot(current_data)
        _ref_mock(mock_firestore_client).get.return_value = snapshot

        def passthrough_transactional(fn):
            mock_txn_callable = MagicMock()
            mock_txn_callable.side_effect = fn
            return mock_txn_callable

        mock_transactional.side_effect = passthrough_transactional

        result = store.write_tokens_if_unmodified(
            "12345", new_tokens, stale_last_refreshed
        )
        assert result is False

    @patch("stravapipe.adapters.firestore.token_store.transactional")
    def test_raises_token_not_found_in_transaction(
        self, mock_transactional, store, mock_firestore_client
    ):
        new_tokens = TokenData(
            access_token="a",
            refresh_token="r",
            expires_at=0,
            scopes="",
            connected_at=datetime.now(tz=UTC),
            last_refreshed=datetime.now(tz=UTC),
        )

        snapshot = _make_doc_snapshot(None, exists=False)
        _ref_mock(mock_firestore_client).get.return_value = snapshot

        def passthrough_transactional(fn):
            mock_txn_callable = MagicMock()
            mock_txn_callable.side_effect = fn
            return mock_txn_callable

        mock_transactional.side_effect = passthrough_transactional

        with pytest.raises(TokenNotFoundError):
            store.write_tokens_if_unmodified(
                "99999",
                new_tokens,
                datetime.now(tz=UTC),
            )


# ============================================================
# FirestoreTokenStore.delete_tokens
# ============================================================


class TestDeleteTokens:
    def test_deletes_token_document(self, store, mock_firestore_client):
        store.delete_tokens("12345")

        _ref_mock(mock_firestore_client).delete.assert_called_once()

    def test_uses_correct_firestore_path(self, store, mock_firestore_client):
        store.delete_tokens("67890")

        mock_firestore_client.collection.assert_called_with(USERS_COLLECTION)
        mock_firestore_client.collection.return_value.document.assert_called_with(
            "67890"
        )
        mock_firestore_client.collection.return_value.document.return_value.collection.assert_called_with(
            PRIVATE_COLLECTION
        )
        mock_firestore_client.collection.return_value.document.return_value.collection.return_value.document.assert_called_with(
            TOKENS_DOCUMENT
        )

    def test_idempotent_delete_non_existent(self, store, mock_firestore_client):
        """Deleting non-existent tokens should not raise."""
        store.delete_tokens("99999")

        _ref_mock(mock_firestore_client).delete.assert_called_once()


# ============================================================
# TokenNotFoundError
# ============================================================


class TestTokenNotFoundError:
    def test_includes_athlete_id_in_message(self):
        err = TokenNotFoundError("42")
        assert "42" in str(err)
        assert err.athlete_id == "42"
