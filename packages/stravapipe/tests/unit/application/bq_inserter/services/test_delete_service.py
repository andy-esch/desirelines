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
    """A single DELETE removes the activity."""
    service, client = _make_service()

    client.execute_dml_query.return_value = 1

    result = service.run(
        activity_id=123456,
        correlation_id="test-123",
        event_time=1696176000,
    )

    assert result.activity_id == 123456
    assert result.rows_deleted == 1
    assert client.execute_dml_query.call_count == 1


def test_delete_activity_not_found():
    """A missing activity deletes nothing and is not an error.

    Already deleted, or never inserted — either way the desired end state
    holds, so the caller treats it as a skip rather than a failure.
    """
    service, client = _make_service()

    client.execute_dml_query.return_value = 0

    result = service.run(
        activity_id=999999,
        correlation_id="test-456",
        event_time=1696176000,
    )

    assert result.activity_id == 999999
    assert result.rows_deleted == 0


def test_delete_activity_retains_no_copy():
    """Deletion must not archive the row into another table.

    This service used to INSERT the activity into `deleted_activities` first,
    which retained the very data the deletion existed to remove.
    """
    service, client = _make_service()
    client.execute_dml_query.return_value = 1

    service.run(activity_id=123456, correlation_id="c", event_time=1696176000)

    query = client.execute_dml_query.call_args.args[0]
    assert "INSERT" not in query.upper()
    assert "deleted_activities" not in query


def test_delete_activity_delete_error():
    """A failed delete propagates, so Pub/Sub redelivers."""
    service, client = _make_service()

    client.execute_dml_query.side_effect = BigQueryError("BigQuery delete failed")

    with pytest.raises(BigQueryError, match="BigQuery delete failed"):
        service.run(
            activity_id=123456,
            correlation_id="test-abc",
            event_time=1696176000,
        )
