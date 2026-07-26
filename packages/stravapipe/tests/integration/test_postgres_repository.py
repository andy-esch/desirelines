"""Integration tests for PostgreSQL activity repository.

Run with: pytest tests/integration/ -v
Requires: PostgreSQL running (docker compose --profile backend up postgres flyway)
"""

from datetime import UTC, datetime
import logging

from sqlalchemy import event, text

from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete
from stravapipe.ports.out.postgres import (
    BackfillUpsertResult,
    DeleteResult,
    InsertResult,
    MetadataUpdateResult,
)


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
            result = uow.activities.insert(activity, None)
            uow.commit()

        assert result is InsertResult.INSERTED

    def test_insert_duplicate_returns_false(self, uow):
        """Insert returns False for duplicate (ON CONFLICT DO NOTHING)."""
        activity = make_activity(activity_id=100002)

        with uow:
            # First insert
            result1 = uow.activities.insert(activity, None)
            uow.commit()

        with uow:
            # Second insert - should be a no-op (already exists)
            result2 = uow.activities.insert(activity, None)
            uow.commit()

        assert result1 is InsertResult.INSERTED
        assert result2 is InsertResult.ALREADY_EXISTS

    def test_exists_returns_true_for_existing(self, uow):
        """exists() returns True after insert."""
        activity = make_activity(activity_id=100003)

        with uow:
            uow.activities.insert(activity, None)
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
            uow.activities.insert(activity, None)
            uow.commit()

        with uow:
            result = uow.activities.update_metadata(
                100004, {"title": "Evening Run"}, None
            )
            uow.commit()

        assert result is MetadataUpdateResult.UPDATED

        # Verify in database
        row = db_session.execute(
            text("SELECT name FROM desirelines.activities WHERE id = :id"),
            {"id": 100004},
        ).fetchone()
        assert row.name == "Evening Run"

    def test_update_metadata_type_does_not_clobber_sport(self, uow, db_session):
        """A bare `type` update writes `type` only and leaves `sport` intact.

        Strava's UPDATE webhook sends the broad `type` ("Ride") but not the
        granular `sport_type` ("MountainBikeRide") that the `sport` column
        holds. Writing the broad type into `sport` would corrupt the granular
        value and break GROUP BY, so `update_metadata` must not touch `sport`.
        The enriched (re-fetched) path uses `upsert` to refresh `sport`.
        """
        # CREATE-time sport is the granular sport_type ("MountainBikeRide").
        activity = make_activity(activity_id=100005)
        activity = activity.model_copy(update={"sport_type": "MountainBikeRide"})

        with uow:
            uow.activities.insert(activity, None)
            uow.commit()

        with uow:
            result = uow.activities.update_metadata(100005, {"type": "Ride"}, None)
            uow.commit()

        assert result is MetadataUpdateResult.UPDATED

        row = db_session.execute(
            text("SELECT type, sport FROM desirelines.activities WHERE id = :id"),
            {"id": 100005},
        ).fetchone()
        assert row.type == "Ride"  # broad type updated
        assert row.sport == "MountainBikeRide"  # granular sport preserved

    def test_upsert_refreshes_sport_on_existing_row(self, uow, db_session):
        """upsert refreshes every column (incl. granular `sport`), keeps created_at."""
        # Existing row from CREATE.
        original = make_activity(activity_id=100007, name="Old Name")
        original = original.model_copy(update={"sport_type": "Run"})
        with uow:
            uow.activities.insert(original, None)
            uow.commit()

        created_row = db_session.execute(
            text("SELECT created_at FROM desirelines.activities WHERE id = :id"),
            {"id": 100007},
        ).fetchone()

        # Re-fetched activity after a type change Run -> MountainBikeRide.
        refreshed = make_activity(activity_id=100007, name="New Name")
        refreshed = refreshed.model_copy(
            update={"type": "Ride", "sport_type": "MountainBikeRide"}
        )
        with uow:
            result = uow.activities.upsert(refreshed, None)
            uow.commit()

        assert result is True
        row = db_session.execute(
            text(
                "SELECT name, type, sport, created_at "
                "FROM desirelines.activities WHERE id = :id"
            ),
            {"id": 100007},
        ).fetchone()
        assert row.name == "New Name"
        assert row.type == "Ride"
        assert row.sport == "MountainBikeRide"  # granular value refreshed
        assert row.created_at == created_row.created_at  # preserved on conflict

    def test_upsert_inserts_when_missing(self, uow, db_session):
        """upsert inserts a row that doesn't exist yet (UPDATE before CREATE)."""
        activity = make_activity(activity_id=100008)
        activity = activity.model_copy(update={"sport_type": "GravelRide"})

        with uow:
            result = uow.activities.upsert(activity, None)
            uow.commit()

        assert result is True
        row = db_session.execute(
            text("SELECT sport FROM desirelines.activities WHERE id = :id"),
            {"id": 100008},
        ).fetchone()
        assert row.sport == "GravelRide"

    def test_update_metadata_returns_not_found_for_missing(self, uow):
        """update_metadata reports NOT_FOUND for a non-existent activity."""
        with uow:
            result = uow.activities.update_metadata(999999, {"title": "New"}, None)
            uow.commit()

        assert result is MetadataUpdateResult.NOT_FOUND

    def test_delete_removes_activity(self, uow):
        """delete removes activity from database."""
        activity = make_activity(activity_id=100006)

        with uow:
            uow.activities.insert(activity, None)
            uow.commit()

        with uow:
            result = uow.activities.delete(100006, 1700000000)
            uow.commit()

        assert result is DeleteResult.DELETED

        with uow:
            exists = uow.activities.exists(100006)

        assert exists is False

    def test_delete_returns_false_for_missing(self, uow):
        """delete returns False for non-existent activity."""
        with uow:
            result = uow.activities.delete(999999, 1700000000)
            uow.commit()

        assert result is DeleteResult.NOT_FOUND

    def test_get_existing_ids(self, uow):
        """get_existing_ids filters a list of IDs and returns only those that exist."""
        activity1 = make_activity(activity_id=100021)
        activity2 = make_activity(activity_id=100022)

        with uow:
            uow.activities.insert(activity1, None)
            uow.activities.insert(activity2, None)
            uow.commit()

        with uow:
            existing = uow.activities.get_existing_ids([100021, 100022, 100023, 999999])

        assert existing == {100021, 100022}

    def test_get_existing_ids_empty(self, uow):
        """get_existing_ids returns an empty set when passed an empty list."""
        with uow:
            existing = uow.activities.get_existing_ids([])
        assert existing == set()


class TestActivityWriteFencing:
    """Integration tests for the last_event_time out-of-order write fence (V0007)."""

    def _last_event_time(self, db_session, activity_id: int):
        return db_session.execute(
            text(
                "SELECT name, last_event_time FROM desirelines.activities "
                "WHERE id = :id"
            ),
            {"id": activity_id},
        ).fetchone()

    def test_upsert_fences_out_of_order_events(self, uow, db_session):
        """A newer event wins; a later-delivered older event is rejected."""
        with uow:
            uow.activities.insert(make_activity(activity_id=100030, name="v1"), 100)
            uow.commit()

        # Newer event (200) applies.
        with uow:
            assert (
                uow.activities.upsert(make_activity(activity_id=100030, name="v2"), 200)
                is True
            )
            uow.commit()

        # Older event (150) arrives late — rejected, row stays on the newer value.
        with uow:
            assert (
                uow.activities.upsert(
                    make_activity(activity_id=100030, name="v3-stale"), 150
                )
                is False
            )
            uow.commit()

        row = self._last_event_time(db_session, 100030)
        assert row.name == "v2"
        assert row.last_event_time == 200

    def test_upsert_equal_event_time_still_applies(self, uow, db_session):
        """Redelivery of the same event (equal event_time) is not fenced out —
        idempotent re-apply, not a stale drop."""
        with uow:
            uow.activities.insert(make_activity(activity_id=100031, name="v1"), 100)
            uow.commit()

        with uow:
            assert (
                uow.activities.upsert(make_activity(activity_id=100031, name="v1"), 100)
                is True
            )
            uow.commit()

        row = self._last_event_time(db_session, 100031)
        assert row.last_event_time == 100

    def test_update_metadata_fences_out_of_order_events(self, uow, db_session):
        """update_metadata reports STALE for an older event and keeps state."""
        with uow:
            uow.activities.insert(make_activity(activity_id=100032, name="v1"), 100)
            uow.commit()

        with uow:
            assert (
                uow.activities.update_metadata(100032, {"title": "v2"}, 200)
                is MetadataUpdateResult.UPDATED
            )
            uow.commit()

        with uow:
            # Older event → STALE (row present but fence rejected), classified
            # atomically and distinctly from NOT_FOUND.
            assert (
                uow.activities.update_metadata(100032, {"title": "v3-stale"}, 150)
                is MetadataUpdateResult.STALE
            )
            uow.commit()

        row = self._last_event_time(db_session, 100032)
        assert row.name == "v2"
        assert row.last_event_time == 200

    def test_update_metadata_equal_event_time_still_applies(self, uow, db_session):
        """Redelivery of the same event (equal event_time) is UPDATED, not STALE."""
        with uow:
            uow.activities.insert(make_activity(activity_id=100035, name="v1"), 100)
            uow.commit()

        with uow:
            assert (
                uow.activities.update_metadata(100035, {"title": "v1-again"}, 100)
                is MetadataUpdateResult.UPDATED
            )
            uow.commit()

        assert self._last_event_time(db_session, 100035).last_event_time == 100

    def test_update_metadata_null_last_event_time_is_not_blocked(self, uow, db_session):
        """A legacy row (last_event_time NULL) accepts a fenced update_metadata
        write and the token advances to the event_time."""
        with uow:
            uow.activities.insert(
                make_activity(activity_id=100036, name="legacy"), None
            )
            uow.commit()

        assert self._last_event_time(db_session, 100036).last_event_time is None

        with uow:
            assert (
                uow.activities.update_metadata(100036, {"title": "fenced"}, 500)
                is MetadataUpdateResult.UPDATED
            )
            uow.commit()

        row = self._last_event_time(db_session, 100036)
        assert row.name == "fenced"
        assert row.last_event_time == 500

    def test_null_last_event_time_is_not_blocked(self, uow, db_session):
        """A legacy/backfill row (last_event_time NULL) accepts the first fenced
        live write — NULL is treated as older."""
        with uow:
            # event_time=None → last_event_time stored NULL (legacy row shape).
            uow.activities.insert(
                make_activity(activity_id=100033, name="legacy"), None
            )
            uow.commit()

        assert self._last_event_time(db_session, 100033).last_event_time is None

        with uow:
            assert (
                uow.activities.upsert(
                    make_activity(activity_id=100033, name="fenced"), 500
                )
                is True
            )
            uow.commit()

        row = self._last_event_time(db_session, 100033)
        assert row.name == "fenced"
        assert row.last_event_time == 500

    def test_backfill_upsert_preserves_live_fence_token(self, uow, db_session):
        """Backfill (event_time=None) refreshes columns but must neither advance
        nor wipe a live-set last_event_time — it stays authoritative for fencing.
        (The backfill-vs-live run-start watermark is a separate follow-up.)"""
        with uow:
            uow.activities.insert(make_activity(activity_id=100034, name="live"), 300)
            uow.commit()

        with uow:
            assert (
                uow.activities.upsert(
                    make_activity(activity_id=100034, name="backfilled"), None
                )
                is True
            )
            uow.commit()

        row = self._last_event_time(db_session, 100034)
        assert row.name == "backfilled"  # additive/upsert-only backfill applied
        assert row.last_event_time == 300  # COALESCE preserved the live token


class TestActivityDeletionTombstone:
    """Integration tests for the deletion tombstone resurrection guard (V0008)."""

    def _tombstone(self, db_session, activity_id: int):
        return db_session.execute(
            text(
                "SELECT deletion_event_time, deletion_correlation_id "
                "FROM desirelines.deleted_activities WHERE id = :id"
            ),
            {"id": activity_id},
        ).fetchone()

    def _activity_exists(self, db_session, activity_id: int) -> bool:
        return (
            db_session.execute(
                text("SELECT 1 FROM desirelines.activities WHERE id = :id"),
                {"id": activity_id},
            ).fetchone()
            is not None
        )

    def test_delete_writes_tombstone_and_removes_row(self, uow, db_session):
        with uow:
            uow.activities.insert(make_activity(activity_id=100040, name="v1"), 100)
            uow.commit()

        with uow:
            assert (
                uow.activities.delete(100040, 200, "corr-xyz") is DeleteResult.DELETED
            )
            uow.commit()

        assert not self._activity_exists(db_session, 100040)
        tomb = self._tombstone(db_session, 100040)
        assert tomb.deletion_event_time == 200
        assert tomb.deletion_correlation_id == "corr-xyz"

    def test_late_create_after_delete_is_blocked(self, uow, db_session):
        with uow:
            uow.activities.insert(make_activity(activity_id=100041, name="v1"), 50)
            uow.commit()

        with uow:
            uow.activities.delete(100041, 200)
            uow.commit()

        # Redelivered/reordered CREATE older than the delete must not resurrect.
        with uow:
            assert (
                uow.activities.insert(
                    make_activity(activity_id=100041, name="ghost"), 100
                )
                is InsertResult.RESURRECTION_BLOCKED
            )
            uow.commit()

        assert not self._activity_exists(db_session, 100041)

    def test_delete_before_create_blocks_the_create(self, uow, db_session):
        # DELETE arrives first (no live row): tombstone is still written.
        with uow:
            assert uow.activities.delete(100042, 200) is DeleteResult.NOT_FOUND
            uow.commit()

        assert self._tombstone(db_session, 100042).deletion_event_time == 200

        with uow:
            assert (
                uow.activities.insert(
                    make_activity(activity_id=100042, name="ghost"), 100
                )
                is InsertResult.RESURRECTION_BLOCKED
            )
            uow.commit()

        assert not self._activity_exists(db_session, 100042)

    def test_create_equal_to_deletion_event_time_is_blocked(self, uow, db_session):
        # Ties go to the delete (>=) — resurrection is worse than dropping a CREATE.
        with uow:
            uow.activities.delete(100043, 100)
            uow.commit()

        with uow:
            assert (
                uow.activities.insert(
                    make_activity(activity_id=100043, name="tie"), 100
                )
                is InsertResult.RESURRECTION_BLOCKED
            )
            uow.commit()

        assert not self._activity_exists(db_session, 100043)

    def test_newer_create_after_delete_is_allowed(self, uow, db_session):
        # A genuine re-creation strictly newer than the delete is accepted.
        with uow:
            uow.activities.delete(100044, 100)
            uow.commit()

        with uow:
            assert (
                uow.activities.insert(
                    make_activity(activity_id=100044, name="reborn"), 200
                )
                is InsertResult.INSERTED
            )
            uow.commit()

        assert self._activity_exists(db_session, 100044)

    def test_repeated_delete_keeps_newest_deletion_event_time(self, uow, db_session):
        with uow:
            uow.activities.delete(100045, 100)
            uow.commit()
        with uow:
            uow.activities.delete(100045, 300)
            uow.commit()

        assert self._tombstone(db_session, 100045).deletion_event_time == 300

        # A CREATE between the two delete times is still blocked by the newest.
        with uow:
            assert (
                uow.activities.insert(
                    make_activity(activity_id=100045, name="mid"), 200
                )
                is InsertResult.RESURRECTION_BLOCKED
            )
            uow.commit()

    def test_backfill_insert_ignores_tombstone(self, uow, db_session):
        # Backfill (event_time=None) is unfenced against the tombstone here; the
        # backfill-vs-delete watermark is a separate follow-up.
        with uow:
            uow.activities.delete(100046, 200)
            uow.commit()

        with uow:
            assert (
                uow.activities.insert(
                    make_activity(activity_id=100046, name="bf"), None
                )
                is InsertResult.INSERTED
            )
            uow.commit()

        assert self._activity_exists(db_session, 100046)

    def test_backfill_upsert_ignores_tombstone(self, uow, db_session):
        # Same deferral as insert: backfill upsert (None) applies past a tombstone.
        with uow:
            uow.activities.delete(100047, 200)
            uow.commit()

        with uow:
            assert (
                uow.activities.upsert(
                    make_activity(activity_id=100047, name="bf-upsert"), None
                )
                is True
            )
            uow.commit()

        assert self._activity_exists(db_session, 100047)

    def test_stale_enriched_update_after_delete_is_blocked(self, uow, db_session):
        # An enriched UPDATE (upsert) older than the delete must not resurrect
        # the activity via its insert leg.
        with uow:
            uow.activities.insert(make_activity(activity_id=100048, name="v1"), 100)
            uow.commit()
        with uow:
            uow.activities.delete(100048, 200)
            uow.commit()

        with uow:
            assert (
                uow.activities.upsert(
                    make_activity(activity_id=100048, name="ghost"), 150
                )
                is False
            )
            uow.commit()

        assert not self._activity_exists(db_session, 100048)

    def test_stale_delete_does_not_remove_newer_recreated_row(self, uow, db_session):
        # delete@200 -> recreate@300 -> stale delete@250: the recreated row must
        # survive and the stale delete is reported STALE.
        with uow:
            uow.activities.insert(make_activity(activity_id=100049, name="v1"), 100)
            uow.commit()
        with uow:
            uow.activities.delete(100049, 200)
            uow.commit()
        with uow:
            assert (
                uow.activities.insert(
                    make_activity(activity_id=100049, name="reborn"), 300
                )
                is InsertResult.INSERTED
            )
            uow.commit()

        with uow:
            assert uow.activities.delete(100049, 250) is DeleteResult.STALE
            uow.commit()

        row = db_session.execute(
            text(
                "SELECT name, last_event_time FROM desirelines.activities "
                "WHERE id = :id"
            ),
            {"id": 100049},
        ).fetchone()
        assert row is not None
        assert row.name == "reborn"
        assert row.last_event_time == 300

    def test_stale_redelete_does_not_overwrite_tombstone_metadata(
        self, uow, db_session
    ):
        # A stale re-delete keeps the newest deletion_event_time AND its metadata.
        with uow:
            uow.activities.delete(100050, 200, "corr-authoritative")
            uow.commit()
        with uow:
            # Older re-delete (row already gone): GREATEST keeps 200, and the
            # correlation_id must stay the authoritative one, not the stale one.
            uow.activities.delete(100050, 150, "corr-stale")
            uow.commit()

        tomb = self._tombstone(db_session, 100050)
        assert tomb.deletion_event_time == 200
        assert tomb.deletion_correlation_id == "corr-authoritative"


class TestBackfillWatermarkUpsert:
    """Integration tests for upsert_backfill: the run-start watermark fence."""

    def _row(self, db_session, activity_id: int):
        return db_session.execute(
            text(
                "SELECT name, last_event_time FROM desirelines.activities "
                "WHERE id = :id"
            ),
            {"id": activity_id},
        ).fetchone()

    def test_backfill_inserts_new_row_with_null_token(self, uow, db_session):
        with uow:
            assert (
                uow.activities.upsert_backfill(
                    make_activity(activity_id=100060, name="bf"), 2000
                )
                is BackfillUpsertResult.APPLIED
            )
            uow.commit()

        row = self._row(db_session, 100060)
        assert row.name == "bf"
        assert row.last_event_time is None  # backfill never sets the token

    def test_backfill_applies_on_null_legacy_token(self, uow, db_session):
        with uow:
            # Legacy row: last_event_time NULL (never touched by a live write).
            uow.activities.insert(make_activity(activity_id=100061, name="old"), None)
            uow.commit()

        with uow:
            assert (
                uow.activities.upsert_backfill(
                    make_activity(activity_id=100061, name="refreshed"), 2000
                )
                is BackfillUpsertResult.APPLIED
            )
            uow.commit()

        row = self._row(db_session, 100061)
        assert row.name == "refreshed"
        assert row.last_event_time is None  # still unfenced

    def test_backfill_applies_when_token_at_or_before_watermark(self, uow, db_session):
        with uow:
            # A live CREATE at event_time 100, before the run started (wm=200).
            uow.activities.insert(make_activity(activity_id=100062, name="live"), 100)
            uow.commit()

        with uow:
            assert (
                uow.activities.upsert_backfill(
                    make_activity(activity_id=100062, name="backfilled"), 200
                )
                is BackfillUpsertResult.APPLIED
            )
            uow.commit()

        row = self._row(db_session, 100062)
        assert row.name == "backfilled"
        assert row.last_event_time == 100  # backfill did not advance the token

    def test_backfill_skips_when_live_event_newer_than_watermark(self, uow, db_session):
        with uow:
            # A live UPDATE landed at event_time 300, after the run start (wm=200).
            uow.activities.insert(make_activity(activity_id=100063, name="live"), 300)
            uow.commit()

        with uow:
            assert (
                uow.activities.upsert_backfill(
                    make_activity(activity_id=100063, name="stale-backfill"), 200
                )
                is BackfillUpsertResult.SKIPPED
            )
            uow.commit()

        row = self._row(db_session, 100063)
        assert row.name == "live"  # the newer live value is preserved
        assert row.last_event_time == 300

    def test_backfill_skips_when_tombstone_newer_than_watermark(self, uow, db_session):
        # A live DELETE (event_time 300) landed after the run start (wm=200):
        # backfill must not resurrect the activity.
        with uow:
            uow.activities.delete(100064, 300)
            uow.commit()

        with uow:
            assert (
                uow.activities.upsert_backfill(
                    make_activity(activity_id=100064, name="ghost"), 200
                )
                is BackfillUpsertResult.SKIPPED
            )
            uow.commit()

        assert self._row(db_session, 100064) is None

    def test_backfill_applies_when_tombstone_at_or_before_watermark(
        self, uow, db_session
    ):
        # A delete older than the run start does not block backfill.
        with uow:
            uow.activities.delete(100065, 100)
            uow.commit()

        with uow:
            assert (
                uow.activities.upsert_backfill(
                    make_activity(activity_id=100065, name="bf"), 200
                )
                is BackfillUpsertResult.APPLIED
            )
            uow.commit()

        assert self._row(db_session, 100065).name == "bf"

    def test_backfill_idempotent_replay_converges(self, uow, db_session):
        # Re-running the same backfill (same watermark) converges with no churn.
        for _ in range(2):
            with uow:
                assert (
                    uow.activities.upsert_backfill(
                        make_activity(activity_id=100066, name="bf"), 2000
                    )
                    is BackfillUpsertResult.APPLIED
                )
                uow.commit()

        row = self._row(db_session, 100066)
        assert row.name == "bf"
        assert row.last_event_time is None


class TestActivityRouteRepository:
    """Integration tests for activity route geometry storage."""

    def test_insert_route_happy_path(self, uow, db_session):
        """insert_route stores geometry and is queryable with PostGIS."""
        activity = make_activity(activity_id=300001)
        geojson = '{"type":"LineString","coordinates":[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]}'

        with uow:
            uow.activities.insert(activity, None)
            result = uow.activities.insert_route(300001, geojson)
            uow.commit()

        assert result is True

        # Verify geometry stored correctly via ST_AsGeoJSON
        row = db_session.execute(
            text(
                "SELECT ST_AsGeoJSON(route)::json->>'type' as geom_type, "
                "ST_NPoints(route) as npoints "
                "FROM desirelines.activity_routes WHERE activity_id = :id"
            ),
            {"id": 300001},
        ).fetchone()
        assert row.geom_type == "LineString"
        assert row.npoints == 3

    def test_insert_route_duplicate_returns_false(self, uow):
        """insert_route returns False for duplicate (ON CONFLICT DO NOTHING)."""
        activity = make_activity(activity_id=300002)
        geojson = '{"type":"LineString","coordinates":[[-120.2,38.5],[-120.95,40.7]]}'

        with uow:
            uow.activities.insert(activity, None)
            result1 = uow.activities.insert_route(300002, geojson)
            uow.commit()

        with uow:
            result2 = uow.activities.insert_route(300002, geojson)
            uow.commit()

        assert result1 is True
        assert result2 is False

    def test_delete_activity_cascades_to_route(self, uow, db_session):
        """Deleting an activity cascades to its route."""
        activity = make_activity(activity_id=300003)
        geojson = '{"type":"LineString","coordinates":[[-120.2,38.5],[-120.95,40.7]]}'

        with uow:
            uow.activities.insert(activity, None)
            uow.activities.insert_route(300003, geojson)
            uow.commit()

        with uow:
            uow.activities.delete(300003, 1700000000)
            uow.commit()

        row = db_session.execute(
            text("SELECT 1 FROM desirelines.activity_routes WHERE activity_id = :id"),
            {"id": 300003},
        ).fetchone()
        assert row is None


def _insert_test_region(session, *, code: str, wkt: str, kind: str = "county") -> int:
    """Insert a controlled test region (rolled back with the test) and return id.

    Placed in the mid-Atlantic in the tests below so it never overlaps the real
    US Census boundaries that may be loaded in the same database.
    """
    row = session.execute(
        text("""
            INSERT INTO desirelines.regions
                (source, region_code, region_kind, region_name, geom)
            VALUES ('test_regions', :code, :kind, 'Test Region',
                    ST_Multi(ST_GeomFromText(:wkt, 4326)))
            RETURNING id
        """),
        {"code": code, "kind": kind, "wkt": wkt},
    ).fetchone()
    return row[0]


# A 2x2 degree box around (-30, 0), far from any real US Census region.
_TEST_REGION_WKT = "POLYGON((-31 -1, -29 -1, -29 1, -31 1, -31 -1))"


def _tagged_region_ids(session, activity_id: int) -> list[int]:
    rows = session.execute(
        text(
            "SELECT region_id FROM desirelines.activity_regions "
            "WHERE activity_id = :id ORDER BY region_id"
        ),
        {"id": activity_id},
    ).fetchall()
    return [r[0] for r in rows]


def _force_spatial_database_error(
    connection, cursor, statement, parameters, context, executemany
):
    """Replace the spatial statement with a real server-side SQL failure."""
    del connection, cursor, context, executemany
    if "ST_Intersects" in statement:
        return (
            "SELECT 1 / 0 WHERE %(activity_id)s = %(activity_id)s",
            parameters,
        )
    return statement, parameters


class TestActivityRegionTagging:
    """Integration tests for tag_activity_regions (V0005 junction + earth)."""

    def test_persists_trainer_and_manual_flags(self, uow, db_session):
        """insert writes the new trainer/manual columns (V0006)."""
        activity = StandardActivity(
            id=210000,
            athlete=MetaAthlete(id=999, resource_state=1),
            name="Indoor Spin",
            type="VirtualRide",
            sport_type="VirtualRide",
            start_date_local=datetime(2024, 1, 15, 7, 30, 0, tzinfo=UTC),
            distance=20000.0,
            moving_time=3600,
            elapsed_time=3600,
            trainer=True,
            manual=False,
        )
        with uow:
            uow.activities.insert(activity, None)
            uow.commit()

        row = db_session.execute(
            text("SELECT trainer, manual FROM desirelines.activities WHERE id = :id"),
            {"id": 210000},
        ).fetchone()
        assert row == (True, False)

    def test_tags_every_intersecting_region(self, uow, db_session):
        """A route is tagged with the specific region(s) it intersects."""
        activity = make_activity(activity_id=210001)
        region_id = _insert_test_region(db_session, code="r1", wkt=_TEST_REGION_WKT)

        with uow:
            uow.activities.insert(activity, None)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-30.5,-0.5],[-30,0],[-29.5,0.5]]}',
            )
            count = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert count == 1
        assert _tagged_region_ids(db_session, activity.id) == [region_id]

    def test_earth_fallback_when_no_specific_region_matches(self, uow, db_session):
        """A route matching no specific region falls back to builtin 'earth'."""
        activity = make_activity(activity_id=210002)
        earth_id = db_session.execute(
            text(
                "SELECT id FROM desirelines.regions "
                "WHERE source='builtin' AND region_code='earth'"
            )
        ).fetchone()[0]

        with uow:
            uow.activities.insert(activity, None)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-45,0],[-44,0]]}',
            )
            count = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert count == 1
        assert _tagged_region_ids(db_session, activity.id) == [earth_id]

    def test_unloaded_regions_logs_and_degrades_to_earth(self, uow, db_session, caplog):
        """A routed fallback with no specific dataset is loud but still succeeds."""
        db_session.execute(
            text("DELETE FROM desirelines.regions WHERE region_kind <> 'global'")
        )
        activity = make_activity(activity_id=210006)

        with caplog.at_level(logging.ERROR), uow:
            uow.activities.insert(activity, None)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-45,0],[-44,0]]}',
            )
            count = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert count == 1
        assert "Regions table appears unloaded or incomplete" in caplog.text

    def test_off_grid_route_does_not_log_unloaded_when_region_floor_met(
        self, uow, db_session, caplog
    ):
        """A legitimate off-grid route is distinct from a broken region dataset."""
        db_session.execute(
            text("DELETE FROM desirelines.regions WHERE region_kind <> 'global'")
        )
        db_session.execute(
            text("""
                INSERT INTO desirelines.regions
                    (source, region_code, region_kind, region_name, geom)
                SELECT
                    'test_floor',
                    'floor-' || n,
                    'county',
                    'Readiness Floor ' || n,
                    ST_Multi(ST_GeomFromText(
                        'POLYGON((-31 -1, -29 -1, -29 1, -31 1, -31 -1))',
                        4326
                    ))
                FROM generate_series(1, 100) AS n
            """)
        )
        activity = make_activity(activity_id=210007)

        with caplog.at_level(logging.ERROR), uow:
            uow.activities.insert(activity, None)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-45,0],[-44,0]]}',
            )
            count = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert count == 1
        assert "Regions table appears unloaded or incomplete" not in caplog.text

    def test_spatial_failure_preserves_existing_specific_tags(
        self, uow, db_session, caplog
    ):
        """The delete and spatial insert roll back together on a transient error."""
        activity = make_activity(activity_id=210008)
        region_id = _insert_test_region(
            db_session,
            code="atomic-retag",
            wkt=_TEST_REGION_WKT,
        )

        with uow:
            uow.activities.insert(activity, None)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-30.5,-0.5],[-29.5,0.5]]}',
            )
            assert uow.activities.tag_activity_regions(activity.id) == 1
            uow.commit()

        connection = db_session.connection()

        event.listen(
            connection,
            "before_cursor_execute",
            _force_spatial_database_error,
            retval=True,
        )
        try:
            with caplog.at_level(logging.WARNING), uow:
                count = uow.activities.tag_activity_regions(activity.id)
                uow.commit()
        finally:
            event.remove(
                connection,
                "before_cursor_execute",
                _force_spatial_database_error,
            )

        assert count == 0
        assert "Region spatial tagging failed" in caplog.text
        assert _tagged_region_ids(db_session, activity.id) == [region_id]

    def test_spatial_database_failure_recovers_new_routed_activity_to_earth(
        self, uow, db_session, caplog
    ):
        """A real failed statement rolls back its savepoint before earth recovery."""
        activity = make_activity(activity_id=210009)
        earth_id = db_session.execute(
            text(
                "SELECT id FROM desirelines.regions "
                "WHERE source='builtin' AND region_code='earth'"
            )
        ).fetchone()[0]
        connection = db_session.connection()

        event.listen(
            connection,
            "before_cursor_execute",
            _force_spatial_database_error,
            retval=True,
        )
        try:
            with caplog.at_level(logging.WARNING), uow:
                uow.activities.insert(activity, None)
                uow.activities.insert_route(
                    activity.id,
                    '{"type":"LineString","coordinates":[[-30.5,-0.5],[-29.5,0.5]]}',
                )
                count = uow.activities.tag_activity_regions(activity.id)
                uow.commit()
        finally:
            event.remove(
                connection,
                "before_cursor_execute",
                _force_spatial_database_error,
            )

        assert count == 1
        assert "Region spatial tagging failed" in caplog.text
        assert _tagged_region_ids(db_session, activity.id) == [earth_id]

    def test_no_route_means_no_tags(self, uow, db_session):
        """An activity without a route gets no region rows (not even earth)."""
        activity = make_activity(activity_id=210003)

        with uow:
            uow.activities.insert(activity, None)
            count = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert count == 0
        assert _tagged_region_ids(db_session, activity.id) == []

    def test_tagging_is_idempotent(self, uow, db_session):
        """Re-tagging clears and rewrites — no duplicate rows."""
        activity = make_activity(activity_id=210004)
        region_id = _insert_test_region(db_session, code="r2", wkt=_TEST_REGION_WKT)

        with uow:
            uow.activities.insert(activity, None)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-30,0],[-29.5,0.2]]}',
            )
            first = uow.activities.tag_activity_regions(activity.id)
            second = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert first == 1
        assert second == 1
        assert _tagged_region_ids(db_session, activity.id) == [region_id]

    def test_clear_activity_regions_removes_tags(self, uow, db_session):
        """clear_activity_regions deletes all tags (e.g. activity became virtual)."""
        activity = make_activity(activity_id=210005)
        _insert_test_region(db_session, code="r3", wkt=_TEST_REGION_WKT)

        with uow:
            uow.activities.insert(activity, None)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-30,0],[-29.5,0.2]]}',
            )
            uow.activities.tag_activity_regions(activity.id)
            assert _tagged_region_ids(db_session, activity.id) != []

            deleted = uow.activities.clear_activity_regions(activity.id)
            uow.commit()

        assert deleted == 1
        assert _tagged_region_ids(db_session, activity.id) == []


class TestTransactionRollback:
    """Tests verifying transaction rollback works correctly."""

    def test_data_isolated_between_tests(self, uow):
        """Each test starts with clean slate due to rollback."""
        # This test creates an activity with specific ID
        activity = make_activity(activity_id=200001)

        with uow:
            uow.activities.insert(activity, None)
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
