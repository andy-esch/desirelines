"""Tests for DeleteActivityService"""

from unittest.mock import Mock

import pytest

from stravapipe.application.bq_inserter.delete_service import DeleteActivityService


def test_delete_activity_success():
    """Test successful activity deletion"""
    # Mock BigQuery client
    bq_client = Mock()

    # Mock INSERT query result
    insert_job = Mock()
    insert_job.result.return_value = None
    insert_job.num_dml_affected_rows = 1  # One row inserted

    # Mock DELETE query result
    delete_job = Mock()
    delete_job.result.return_value = None

    # Set up side effects for both queries
    bq_client.query.side_effect = [insert_job, delete_job]

    # Create service
    service = DeleteActivityService(
        bq_client=bq_client, project_id="test-project", dataset_id="test_dataset"
    )

    # Run deletion
    result = service.run(
        activity_id=123456,
        correlation_id="test-123",
        event_time=1696176000,
    )

    # Verify result
    assert result["status"] == "processed"
    assert result["action"] == "deleted"
    assert result["activity_id"] == 123456

    # Verify BigQuery calls
    assert bq_client.query.call_count == 2  # INSERT and DELETE


def test_delete_activity_not_found():
    """Test deletion when activity doesn't exist"""
    # Mock BigQuery client
    bq_client = Mock()

    # Mock INSERT query result with no rows affected
    insert_job = Mock()
    insert_job.result.return_value = None
    insert_job.num_dml_affected_rows = 0  # No rows inserted (activity not found)
    bq_client.query.return_value = insert_job

    # Create service
    service = DeleteActivityService(
        bq_client=bq_client, project_id="test-project", dataset_id="test_dataset"
    )

    # Run deletion
    result = service.run(
        activity_id=999999,
        correlation_id="test-456",
        event_time=1696176000,
    )

    # Verify result
    assert result["status"] == "skipped"
    assert result["reason"] == "activity_not_found"
    assert result["activity_id"] == 999999

    # Should only run INSERT query (which returns 0 rows), not DELETE
    assert bq_client.query.call_count == 1


def test_delete_activity_insert_error():
    """Test deletion when archive insert fails"""
    # Mock BigQuery client
    bq_client = Mock()

    # Mock INSERT query failure
    insert_job = Mock()
    insert_job.result.side_effect = Exception("BigQuery insert failed")
    bq_client.query.return_value = insert_job

    # Create service
    service = DeleteActivityService(
        bq_client=bq_client, project_id="test-project", dataset_id="test_dataset"
    )

    # Run deletion - should raise exception
    with pytest.raises(Exception, match="BigQuery insert failed"):
        service.run(
            activity_id=123456,
            correlation_id="test-789",
            event_time=1696176000,
        )


def test_delete_activity_delete_error():
    """Test deletion when delete query fails after successful insert"""
    # Mock BigQuery client
    bq_client = Mock()

    # Mock successful INSERT
    insert_job = Mock()
    insert_job.result.return_value = None
    insert_job.num_dml_affected_rows = 1

    # Mock failed DELETE
    delete_job = Mock()
    delete_job.result.side_effect = Exception("BigQuery delete failed")

    bq_client.query.side_effect = [insert_job, delete_job]

    # Create service
    service = DeleteActivityService(
        bq_client=bq_client, project_id="test-project", dataset_id="test_dataset"
    )

    # Run deletion - should raise exception
    with pytest.raises(Exception, match="BigQuery delete failed"):
        service.run(
            activity_id=123456,
            correlation_id="test-abc",
            event_time=1696176000,
        )
