"""Integration tests for PostgreSQL activity repository.

Run with: pytest tests/integration/ -v
Requires: PostgreSQL running (docker compose --profile backend up postgres flyway)
"""

from datetime import UTC, datetime

from sqlalchemy import text

from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete


def make_activity(
    activity_id: int = 12345,
    user_id: int = 999,
    name: str = "Morning Run",
) -> StandardActivity:
    """Create test activity."""
    return StandardActivity(
        id=activity_id,
        athlete=MetaAthlete(id=user_id, resource_state=1),
        name=name,
        type="Run",
        sport_type="Run",
        start_date_local=datetime(2024, 1, 15, 7, 30, 0, tzinfo=UTC),
        distance=5000.0,
        moving_time=1800,
        elapsed_time=2000,
        total_elevation_gain=50.0,
    )


class TestActivityRepository:
    """Integration tests for SqlAlchemyActivityRepository."""

    def test_insert_new_activity(self, uow):
        """Insert creates new activity."""
        activity = make_activity(activity_id=100001)

        with uow:
            result = uow.activities.insert(activity)
            uow.commit()

        assert result is True

    def test_insert_duplicate_returns_false(self, uow):
        """Insert returns False for duplicate (ON CONFLICT DO NOTHING)."""
        activity = make_activity(activity_id=100002)

        with uow:
            # First insert
            result1 = uow.activities.insert(activity)
            uow.commit()

        with uow:
            # Second insert - should return False
            result2 = uow.activities.insert(activity)
            uow.commit()

        assert result1 is True
        assert result2 is False

    def test_exists_returns_true_for_existing(self, uow):
        """exists() returns True after insert."""
        activity = make_activity(activity_id=100003)

        with uow:
            uow.activities.insert(activity)
            uow.commit()

        with uow:
            exists = uow.activities.exists(100003)

        assert exists is True

    def test_exists_returns_false_for_missing(self, uow):
        """exists() returns False for non-existent activity."""
        with uow:
            exists = uow.activities.exists(999999)

        assert exists is False

    def test_update_metadata_changes_name(self, uow, db_session):
        """update_metadata updates name column."""
        activity = make_activity(activity_id=100004)

        with uow:
            uow.activities.insert(activity)
            uow.commit()

        with uow:
            result = uow.activities.update_metadata(100004, {"title": "Evening Run"})
            uow.commit()

        assert result is True

        # Verify in database
        row = db_session.execute(
            text("SELECT name FROM desirelines.activities WHERE id = :id"),
            {"id": 100004},
        ).fetchone()
        assert row.name == "Evening Run"

    def test_update_metadata_changes_type_and_sport(self, uow, db_session):
        """update_metadata updates both type and sport columns.

        Strava webhooks send 'type' (base type like "Ride") not 'sport_type'
        (specific type like "MountainBikeRide"). While lossy, updating both
        columns is better than leaving stale data - "Ride" is more correct
        than "Run" if the user changed their activity type.
        """
        activity = make_activity(activity_id=100005)

        with uow:
            uow.activities.insert(activity)
            uow.commit()

        with uow:
            result = uow.activities.update_metadata(100005, {"type": "Ride"})
            uow.commit()

        assert result is True

        row = db_session.execute(
            text("SELECT type, sport FROM desirelines.activities WHERE id = :id"),
            {"id": 100005},
        ).fetchone()
        assert row.type == "Ride"
        assert row.sport == "Ride"

    def test_update_metadata_returns_false_for_missing(self, uow):
        """update_metadata returns False for non-existent activity."""
        with uow:
            result = uow.activities.update_metadata(999999, {"title": "New"})
            uow.commit()

        assert result is False

    def test_delete_removes_activity(self, uow):
        """delete removes activity from database."""
        activity = make_activity(activity_id=100006)

        with uow:
            uow.activities.insert(activity)
            uow.commit()

        with uow:
            result = uow.activities.delete(100006)
            uow.commit()

        assert result is True

        with uow:
            exists = uow.activities.exists(100006)

        assert exists is False

    def test_delete_returns_false_for_missing(self, uow):
        """delete returns False for non-existent activity."""
        with uow:
            result = uow.activities.delete(999999)
            uow.commit()

        assert result is False


class TestTransactionRollback:
    """Tests verifying transaction rollback works correctly."""

    def test_data_isolated_between_tests(self, uow):
        """Each test starts with clean slate due to rollback."""
        # This test creates an activity with specific ID
        activity = make_activity(activity_id=200001)

        with uow:
            uow.activities.insert(activity)
            uow.commit()

        with uow:
            exists = uow.activities.exists(200001)

        assert exists is True
        # After test, rollback removes this data

    def test_previous_test_data_not_visible(self, uow):
        """Previous test's data should not be visible (proves rollback)."""
        # ID 200001 was used in previous test - should not exist
        with uow:
            exists = uow.activities.exists(200001)

        assert exists is False
