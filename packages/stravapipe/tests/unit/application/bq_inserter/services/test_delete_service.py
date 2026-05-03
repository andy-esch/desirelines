"""Tests for DeleteActivityService"""

from unittest.mock import MagicMock

import pytest

from stravapipe.application.bq_inserter.delete_service import DeleteActivityService
from stravapipe.exceptions import BigQueryError


def _make_service(client=None):
    if client is None:
        client = MagicMock()
    return DeleteActivityService(client=client, dataset_id="test_dataset"), client


def test_delete_activity_success():
    """Test successful activity deletion"""
    service, client = _make_service()

    # First DML call (archive) returns 1 row, second (delete) returns 1 row
    client.execute_dml_query.side_effect = [1, 1]

    result = service.run(
        activity_id=123456,
        correlation_id="test-123",
        event_time=1696176000,
    )

    assert result.activity_id == 123456
    assert result.rows_archived == 1
    assert result.rows_deleted == 1
    assert client.execute_dml_query.call_count == 2


def test_delete_activity_not_found():
    """Test deletion when activity doesn't exist"""
    service, client = _make_service()

    # Archive returns 0 rows — activity not found
    client.execute_dml_query.return_value = 0

    result = service.run(
        activity_id=999999,
        correlation_id="test-456",
        event_time=1696176000,
    )

    assert result.activity_id == 999999
    assert result.rows_archived == 0
    assert result.rows_deleted == 0
    # Should only run archive query, not delete
    assert client.execute_dml_query.call_count == 1


def test_delete_activity_insert_error():
    """Test deletion when archive insert fails"""
    service, client = _make_service()

    client.execute_dml_query.side_effect = BigQueryError("BigQuery insert failed")

    with pytest.raises(BigQueryError, match="BigQuery insert failed"):
        service.run(
            activity_id=123456,
            correlation_id="test-789",
            event_time=1696176000,
        )


def test_delete_activity_delete_error():
    """Test deletion when delete query fails after successful archive"""
    service, client = _make_service()

    # Archive succeeds (1 row), delete fails
    client.execute_dml_query.side_effect = [
        1,
        BigQueryError("BigQuery delete failed"),
    ]

    with pytest.raises(BigQueryError, match="BigQuery delete failed"):
        service.run(
            activity_id=123456,
            correlation_id="test-abc",
            event_time=1696176000,
        )
