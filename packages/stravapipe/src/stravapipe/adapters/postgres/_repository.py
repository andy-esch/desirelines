"""SQLAlchemy repository for PostgreSQL activity storage.

Uses raw SQL via sa.text() for simple, efficient queries.
Repository receives Session from Unit of Work - doesn't manage its own connection.
"""

from datetime import UTC, datetime
from functools import partial
import logging
from typing import Any, Final, cast

from sqlalchemy import text
from sqlalchemy.engine import CursorResult, Result
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from stravapipe.domain import StandardActivity
from stravapipe.ports.out.postgres import (
    ActivityRepository,
    BackfillUpsertResult,
    DeleteResult,
    InsertResult,
    MetadataUpdateResult,
)
from stravapipe.shared.logging import log_best_effort

logger = logging.getLogger(__name__)

# Whitelist of allowed update keys and their corresponding SQL clauses
# This prevents SQL injection by only allowing known, safe column updates.
#
# A bare `type` update writes ONLY the `type` column — never `sport`. Strava's
# UPDATE webhook carries the broad `type` ("Ride") but not the granular
# `sport_type` ("MountainBikeRide"); the `sport` column stores the latter
# (domain `sport` property = `sport_type`). Writing the broad type into `sport`
# would corrupt the granular value and break GROUP BY. `sport` is refreshed
# only via `upsert()`, on the enriched (re-fetched) UPDATE path.
_ALLOWED_UPDATE_CLAUSES: Final[dict[str, list[str]]] = {
    "title": ["name = :name"],
    "type": ["type = :type"],
}

# Full-write PostgreSQL column -> StandardActivity attribute mapping, in INSERT
# order. This is the single source of truth for both SQL generation and bind
# values, so a persisted field cannot be added to one and omitted from the
# other. Computed StandardActivity attributes (`user_id`, `sport`, and `year`)
# are intentionally named here alongside direct model fields.
_ACTIVITY_COLUMN_ATTRIBUTES: Final[dict[str, str]] = {
    "id": "id",
    "user_id": "user_id",
    "name": "name",
    "type": "type",
    "sport": "sport",
    "start_date_local": "start_date_local",
    "distance": "distance",
    "moving_time": "moving_time",
    "elapsed_time": "elapsed_time",
    "total_elevation_gain": "total_elevation_gain",
    "average_speed": "average_speed",
    "max_speed": "max_speed",
    "average_heartrate": "average_heartrate",
    "max_heartrate": "max_heartrate",
    "trainer": "trainer",
    "manual": "manual",
    "year": "year",
}
_ACTIVITY_SYSTEM_COLUMNS: Final[tuple[str, ...]] = (
    "created_at",
    "updated_at",
)
_ACTIVITY_COLUMNS: Final[tuple[str, ...]] = (
    *_ACTIVITY_COLUMN_ATTRIBUTES,
    *_ACTIVITY_SYSTEM_COLUMNS,
)
# `id` and `created_at` are insert-only: never in the ON CONFLICT DO UPDATE
# SET clause, so the original `created_at` survives an upsert.
_ACTIVITY_INSERT_ONLY_COLUMNS: Final[frozenset[str]] = frozenset({"id", "created_at"})

# `last_event_time` is the out-of-order write fence (see V0007). It rides on the
# INSERT column list but is NOT in `_ACTIVITY_COLUMN_ATTRIBUTES` — it's an
# attribute of the webhook *event*, not of `StandardActivity` — so it threads in
# as a separate `event_time` param, and it gets bespoke SET/WHERE handling below
# rather than the generic `col = EXCLUDED.col` refresh.
_ACTIVITY_INSERT_COLUMNS: Final[tuple[str, ...]] = (
    *_ACTIVITY_COLUMNS,
    "last_event_time",
)

_ACTIVITY_UPSERT_SET_SQL: Final[str] = ", ".join(
    f"{col} = EXCLUDED.{col}"
    for col in _ACTIVITY_COLUMNS
    if col not in _ACTIVITY_INSERT_ONLY_COLUMNS
)

# Advance the fence only when the caller supplies a newer event_time. Backfill
# passes event_time=None (EXCLUDED.last_event_time IS NULL), so COALESCE keeps
# the existing live token rather than wiping it. Kept out of the generated SET
# above so backfill can never clobber a live-set value.
_ACTIVITY_LAST_EVENT_TIME_SET: Final[str] = (
    "last_event_time = COALESCE(EXCLUDED.last_event_time, activities.last_event_time)"
)
# Reject a stale/reordered *live* event on the upsert conflict. NULL on either
# side means "unfenced": a legacy row (stored NULL) or a backfill write
# (incoming NULL) is always allowed through — the backfill-vs-live watermark is
# a separate concern (see task apply-the-backfill-run-start-watermark-...).
_ACTIVITY_UPSERT_EVENT_TIME_GUARD: Final[str] = (
    "activities.last_event_time IS NULL "
    "OR EXCLUDED.last_event_time IS NULL "
    "OR activities.last_event_time <= EXCLUDED.last_event_time"
)

# CREATE path. Existence, the deletion-tombstone guard, and the write are all
# resolved in one statement so a concurrently-committed DELETE can't race the
# classification. The `tombstone` CTE fires only when the incoming event_time is
# not strictly newer than a recorded deletion_event_time (>= blocks; a genuine
# re-creation with a newer event_time is allowed through). event_time=None
# (backfill) makes the `>=` comparison NULL, so the tombstone never blocks and
# the row inserts unfenced — backfill-vs-delete ordering is the watermark task's
# concern. The outer SELECT reports inserted vs blocked so the caller can tell
# RESURRECTION_BLOCKED from ALREADY_EXISTS.
_ACTIVITY_TOMBSTONED_INSERT_SQL: Final[str] = (
    "WITH tombstone AS ("
    "  SELECT 1 FROM desirelines.deleted_activities"
    "  WHERE id = :id AND deletion_event_time >= :last_event_time"
    "), ins AS ("
    f"  INSERT INTO desirelines.activities ({', '.join(_ACTIVITY_INSERT_COLUMNS)})"
    f"  SELECT {', '.join(f':{col}' for col in _ACTIVITY_INSERT_COLUMNS)}"
    "  WHERE NOT EXISTS (SELECT 1 FROM tombstone)"
    "  ON CONFLICT (id) DO NOTHING"
    "  RETURNING id"
    ")"
    " SELECT"
    "  EXISTS (SELECT 1 FROM ins) AS inserted,"
    "  EXISTS (SELECT 1 FROM tombstone) AS blocked"
)

# UPSERT insert-leg is tombstone-guarded too (enriched UPDATE = a live write that
# would otherwise resurrect a deleted activity via its insert leg). Same guard as
# the CREATE path; when the tombstone blocks, the SELECT yields no row so nothing
# inserts and no conflict fires. On an existing row the SELECT yields a row, the
# INSERT conflicts, and the fenced DO UPDATE runs as before.
_ACTIVITY_INSERT_SELECT_SQL: Final[str] = (
    f"INSERT INTO desirelines.activities ({', '.join(_ACTIVITY_INSERT_COLUMNS)}) "
    f"SELECT {', '.join(f':{col}' for col in _ACTIVITY_INSERT_COLUMNS)} "
    "WHERE NOT EXISTS ("
    "  SELECT 1 FROM desirelines.deleted_activities"
    "  WHERE id = :id AND deletion_event_time >= :last_event_time"
    ")"
)

# BACKFILL path. A backfill fetched its activities as of the run's start
# (:watermark), so it must not overwrite state a newer live event already wrote.
# It is fenced on the watermark, not on an event_time it doesn't have, and it
# never touches last_event_time (omitted from the SET; the insert leg binds NULL):
#   - insert leg blocked by a deletion tombstone strictly newer than the watermark
#     (a live DELETE after run start — don't resurrect);
#   - conflict (DO UPDATE) applied only when the row is unfenced (NULL) or its
#     last_event_time is at-or-before the watermark (no newer live UPDATE).
# No row returned => the write was skipped (a newer live event owns the row).
_ACTIVITY_BACKFILL_UPSERT_SQL: Final[str] = (
    f"INSERT INTO desirelines.activities ({', '.join(_ACTIVITY_INSERT_COLUMNS)}) "
    f"SELECT {', '.join(f':{col}' for col in _ACTIVITY_INSERT_COLUMNS)} "
    "WHERE NOT EXISTS ("
    "  SELECT 1 FROM desirelines.deleted_activities"
    "  WHERE id = :id AND deletion_event_time > :watermark"
    ") "
    f"ON CONFLICT (id) DO UPDATE SET {_ACTIVITY_UPSERT_SET_SQL} "
    "WHERE activities.last_event_time IS NULL "
    "OR activities.last_event_time <= :watermark "
    "RETURNING id"
)

# DELETE path. Read + lock the live row's fence token first so a stale/reordered
# DELETE can't remove a newer (re-created) row, then upsert the tombstone and
# hard-delete. GREATEST keeps the newest deletion_event_time; deleted_at and
# correlation_id only advance with it (a stale re-delete must not overwrite the
# authoritative delete's metadata). Everything runs in the caller's Unit of Work.
_SELECT_ACTIVITY_FENCE_FOR_UPDATE_SQL: Final[str] = (
    "SELECT last_event_time FROM desirelines.activities "
    "WHERE id = :activity_id FOR UPDATE"
)
_TOMBSTONE_UPSERT_SQL: Final[str] = (
    "INSERT INTO desirelines.deleted_activities"
    " (id, deletion_event_time, deleted_at, deletion_correlation_id)"
    " VALUES (:activity_id, :event_time, :deleted_at, :correlation_id)"
    " ON CONFLICT (id) DO UPDATE SET"
    "  deletion_event_time = GREATEST("
    "    deleted_activities.deletion_event_time, EXCLUDED.deletion_event_time),"
    "  deleted_at = CASE"
    "    WHEN EXCLUDED.deletion_event_time >= deleted_activities.deletion_event_time"
    "    THEN EXCLUDED.deleted_at ELSE deleted_activities.deleted_at END,"
    "  deletion_correlation_id = CASE"
    "    WHEN EXCLUDED.deletion_event_time >= deleted_activities.deletion_event_time"
    "    THEN EXCLUDED.deletion_correlation_id"
    "    ELSE deleted_activities.deletion_correlation_id END"
)
_DELETE_ACTIVITY_SQL: Final[str] = (
    "DELETE FROM desirelines.activities WHERE id = :activity_id RETURNING id"
)

_DELETE_ACTIVITY_REGIONS_SQL: Final[str] = (
    "DELETE FROM desirelines.activity_regions WHERE activity_id = :activity_id"
)

# Keep aligned with the standalone region-backfill guard. The census load is
# roughly 3,900 non-global rows; this deliberately low floor catches an empty
# or partial load without coupling ingestion to one specific dataset vintage.
_MIN_SPECIFIC_REGIONS: Final[int] = 100

_ACTIVITY_HAS_ROUTE_SQL: Final[str] = """
    SELECT EXISTS (
        SELECT 1
        FROM desirelines.activity_routes
        WHERE activity_id = :activity_id
    )
"""

_EARTH_FALLBACK_SQL: Final[str] = """
    INSERT INTO desirelines.activity_regions (activity_id, region_id)
    SELECT :activity_id, re.id
    FROM desirelines.regions re
    WHERE re.source = 'builtin'
      AND re.region_code = 'earth'
      AND EXISTS (
          SELECT 1
          FROM desirelines.activity_routes ro
          WHERE ro.activity_id = :activity_id
      )
      AND NOT EXISTS (
          SELECT 1
          FROM desirelines.activity_regions ar
          WHERE ar.activity_id = :activity_id
      )
    ON CONFLICT DO NOTHING
    RETURNING region_id
"""

_REGION_READINESS_SQL: Final[str] = """
    SELECT
        (
            SELECT count(*)
            FROM desirelines.regions
            WHERE region_kind <> 'global'
        ) AS specific_region_count,
        EXISTS (
            SELECT 1
            FROM desirelines.regions
            WHERE source = 'builtin'
              AND region_code = 'earth'
        ) AS has_earth_region
"""


def _activity_write_params(activity: StandardActivity, now: datetime) -> dict[str, Any]:
    """Bind params for a full activity write (``insert`` / ``upsert``).

    ``created_at`` and ``updated_at`` are both set to ``now``; on an upsert
    conflict ``created_at`` isn't in the SET clause, so the original is kept.
    The ``last_event_time`` fence token is bound by the caller (``insert`` /
    ``upsert``) since it comes from the event envelope, not the activity model.
    """
    params = {
        column: getattr(activity, attribute)
        for column, attribute in _ACTIVITY_COLUMN_ATTRIBUTES.items()
    }
    params.update(
        {
            "created_at": now,
            "updated_at": now,
        }
    )
    return params


def _rowcount(result: Result[Any]) -> int:
    """Return the number of rows a DML statement affected.

    ``Session.execute`` is typed ``Result[Any]``, but for DML the runtime
    value is ``CursorResult`` — which is where ``rowcount`` lives.
    """
    rowcount = cast(CursorResult[Any], result).rowcount
    return rowcount if rowcount is not None else 0


class SqlAlchemyActivityRepository(ActivityRepository):
    """PostgreSQL repository for StandardActivity using SQLAlchemy.

    This repository does NOT manage its own session/connection.
    It receives a Session from the Unit of Work pattern.

    Usage:
        with uow:
            uow.activities.upsert(activity)
            uow.commit()
    """

    def __init__(self, session: Session):
        """Initialize repository with an active session.

        Args:
            session: SQLAlchemy Session from Unit of Work
        """
        self._session = session

    def insert(
        self, activity: StandardActivity, event_time: int | None
    ) -> InsertResult:
        """Insert activity, ignore if already exists, block resurrection.

        ON CONFLICT DO NOTHING makes a duplicate CREATE a no-op. A deletion
        tombstone (see ``delete``) whose ``deletion_event_time`` is >= this
        CREATE's ``event_time`` blocks the insert so a late/reordered CREATE
        can't resurrect a deleted activity; a genuinely newer re-creation is
        allowed. The insert leg records ``event_time`` as ``last_event_time`` so
        a later UPDATE can fence against this CREATE. Existence, tombstone, and
        write are classified in one statement (no race with a concurrent delete).

        Args:
            activity: StandardActivity domain model
            event_time: webhook event_time (unix seconds); ``None`` (backfill)
                skips the tombstone guard and stores a NULL fence token

        Returns:
            An :class:`InsertResult` (``INSERTED`` / ``ALREADY_EXISTS`` /
            ``RESURRECTION_BLOCKED``).
        """
        params = _activity_write_params(activity, datetime.now(UTC))
        params["last_event_time"] = event_time
        row = self._session.execute(
            text(_ACTIVITY_TOMBSTONED_INSERT_SQL), params
        ).fetchone()
        if row is not None and row.inserted:
            return InsertResult.INSERTED
        if row is not None and row.blocked:
            return InsertResult.RESURRECTION_BLOCKED
        return InsertResult.ALREADY_EXISTS

    def upsert(self, activity: StandardActivity, event_time: int | None) -> bool:
        """Insert activity, or refresh every column if it already exists.

        Used for enriched UPDATE webhooks (a type change) where the dispatcher
        re-fetched the full Strava activity, and for backfill. ON CONFLICT DO
        UPDATE refreshes all columns from authoritative Strava data, preserving
        the original `created_at`.

        The conflict branch is fenced on ``last_event_time``: a live event whose
        ``event_time`` is older than the row's stored token is rejected (returns
        False — the row is left on its newer state). The insert leg is also
        tombstone-guarded like ``insert`` so a stale enriched UPDATE for a
        deleted activity can't resurrect it via the insert leg (returns False).
        A backfill write passes ``event_time=None``, which is unfenced against
        both the token and the tombstone (always applied, never advances the
        token) — the backfill-vs-live/delete watermark is handled separately
        (task apply-the-backfill-run-start-watermark-...).

        Routes are intentionally not touched here: a type change doesn't alter
        geometry, and the route was written on CREATE. (In the rare case the
        row is *inserted* here — a type-change UPDATE arriving before its
        CREATE — the route is left unpopulated; a later re-sync/backfill covers
        that edge.)

        Args:
            activity: StandardActivity domain model (full, freshly fetched)
            event_time: webhook event_time (unix seconds); ``None`` for backfill

        Returns:
            True if the row was inserted or updated; False if a stale live event
            was rejected by the fence guard or blocked by a deletion tombstone.
        """
        query = text(
            f"{_ACTIVITY_INSERT_SELECT_SQL} "
            f"ON CONFLICT (id) DO UPDATE SET "
            f"{_ACTIVITY_UPSERT_SET_SQL}, {_ACTIVITY_LAST_EVENT_TIME_SET} "
            f"WHERE {_ACTIVITY_UPSERT_EVENT_TIME_GUARD} "
            f"RETURNING id"
        )
        params = _activity_write_params(activity, datetime.now(UTC))
        params["last_event_time"] = event_time
        result = self._session.execute(query, params)
        return result.fetchone() is not None

    def upsert_backfill(
        self, activity: StandardActivity, watermark: int
    ) -> BackfillUpsertResult:
        """Upsert an activity from a backfill run, fenced on the run watermark.

        Skips the write when a live event newer than ``watermark`` already owns
        the row (a live UPDATE via ``last_event_time`` or a live DELETE via the
        tombstone), otherwise refreshes all activity columns. Never sets or
        advances ``last_event_time`` — a refreshed row keeps its token and a
        newly-inserted backfill row gets NULL. See ``_ACTIVITY_BACKFILL_UPSERT_SQL``.

        Args:
            activity: StandardActivity domain model (from the backfill fetch)
            watermark: the backfill run's start time (unix seconds)

        Returns:
            APPLIED if the row was inserted or updated; SKIPPED if a newer live
            event owns it.
        """
        params = _activity_write_params(activity, datetime.now(UTC))
        params["last_event_time"] = None
        params["watermark"] = watermark
        result = self._session.execute(text(_ACTIVITY_BACKFILL_UPSERT_SQL), params)
        return (
            BackfillUpsertResult.APPLIED
            if result.fetchone() is not None
            else BackfillUpsertResult.SKIPPED
        )

    def insert_route(self, activity_id: int, geojson: str) -> bool:
        """Insert activity route geometry, ignore if already exists.

        Args:
            activity_id: Strava activity ID (must exist in activities table)
            geojson: GeoJSON LineString string for ST_GeomFromGeoJSON()

        Returns:
            True if inserted, False if already existed (conflict)
        """
        query = text("""
            INSERT INTO desirelines.activity_routes (activity_id, route)
            VALUES (:activity_id, ST_GeomFromGeoJSON(:geojson))
            ON CONFLICT (activity_id) DO NOTHING
            RETURNING activity_id
        """)

        result = self._session.execute(
            query,
            {"activity_id": activity_id, "geojson": geojson},
        )
        return result.fetchone() is not None

    def tag_activity_regions(self, activity_id: int) -> int:
        """Tag an activity with every region its route intersects (many-to-many).

        Writes ``desirelines.activity_regions`` rows for each region whose boundary
        the route linestring intersects (``ST_Intersects``), across all boundary
        layers — a long route legitimately crosses several counties and >=1 CBSA.
        The builtin ``earth`` fallback (``region_kind = 'global'``) is excluded
        from the intersect and assigned only when the route matches no specific
        region, so any activity that has a route ends up with >=1 region row.

        Idempotent and atomic: clears and rewrites the activity's tags inside one
        SAVEPOINT, so re-tagging (a backfill, or a boundary-dataset reload) is
        safe and a transient failure preserves the previously committed tags.

        Resilience: the delete, spatial join, and ``earth`` fallback run inside a
        SAVEPOINT. If any step fails (a pathological geometry, a statement timeout
        on a very long route), we roll back just the savepoint, log the failed
        phase and exception class, and leave existing tags unchanged. If spatial
        matching fails for a newly inserted routed activity, a fresh savepoint
        assigns ``earth`` without replacing any restored existing tags. The
        surrounding activity insert is never aborted.

        Readiness: after a successful ``earth`` fallback, a cold-path query checks
        that the non-global regions dataset meets a conservative minimum. An
        unloaded or partial dataset is logged loudly while ingestion continues.

        The caller must NOT call this for virtual/indoor activities — their
        geometry is absent or fake (Zwift's polyline is a virtual world), so they
        belong in the complementary non-map view with zero region rows.

        Args:
            activity_id: Strava activity ID. Its route may already exist or have
                been written in the current transaction.

        Returns:
            Number of region rows written (0 if the activity has no route).
        """
        specific: list[Any] = []
        earth: list[Any] = []
        has_route = False
        phase = "reset"
        try:
            with self._session.begin_nested():
                self._session.execute(
                    text(_DELETE_ACTIVITY_REGIONS_SQL),
                    {"activity_id": activity_id},
                )

                # Specific regions: every non-fallback boundary the route intersects.
                phase = "spatial"
                specific = list(
                    self._session.execute(
                        text("""
                            INSERT INTO desirelines.activity_regions (activity_id, region_id)
                            SELECT ro.activity_id, re.id
                            FROM desirelines.activity_routes ro
                            JOIN desirelines.regions re
                              ON ST_Intersects(ro.route, re.geom)
                            WHERE ro.activity_id = :activity_id
                              AND re.region_kind <> 'global'
                            RETURNING region_id
                        """),
                        {"activity_id": activity_id},
                    ).fetchall()
                )

                if not specific:
                    phase = "route"
                    has_route = bool(
                        self._session.execute(
                            text(_ACTIVITY_HAS_ROUTE_SQL),
                            {"activity_id": activity_id},
                        ).scalar_one()
                    )

                    # Fallback: tag the builtin 'earth' region, but only if the
                    # activity actually has a route (no route -> no geography).
                    if has_route:
                        phase = "earth"
                        earth = list(
                            self._session.execute(
                                text(_EARTH_FALLBACK_SQL),
                                {"activity_id": activity_id},
                            ).fetchall()
                        )
        except SQLAlchemyError as exc:
            failed_operation = {
                "reset": "region-tag reset",
                "spatial": "region spatial tagging",
                "route": "activity route check",
                "earth": "earth region fallback",
            }[phase]
            log_best_effort(
                partial(
                    logger.warning,
                    "%s failed for activity %s (%s); the atomic rewrite was "
                    "rolled back, existing tags are preserved when present, "
                    "and ingestion continues",
                    failed_operation.capitalize(),
                    activity_id,
                    type(exc).__name__,
                    exc_info=True,
                )
            )

            # The rolled-back savepoint restores existing tags, but a newly
            # inserted routed activity has no tags to restore. Recover that case
            # to the global fallback in a fresh savepoint. The NOT EXISTS guard
            # leaves previously tagged activities untouched.
            if phase != "spatial":
                return 0
            return self._recover_earth_after_spatial_failure(activity_id)

        if specific:
            return len(specific)
        if not has_route:
            return 0

        # A successful specific-region query that fell through to earth is the
        # only path where dataset readiness matters. Keep the count query here,
        # off the normal spatial-match hot path. Its own savepoint ensures this
        # observability check cannot poison the surrounding write transaction.
        self._observe_region_readiness(activity_id)
        return len(earth)

    def _recover_earth_after_spatial_failure(self, activity_id: int) -> int:
        """Assign earth to a routed activity only when it has no restored tags."""
        try:
            with self._session.begin_nested():
                recovered_earth = list(
                    self._session.execute(
                        text(_EARTH_FALLBACK_SQL),
                        {"activity_id": activity_id},
                    ).fetchall()
                )
        except SQLAlchemyError as recovery_exc:
            log_best_effort(
                partial(
                    logger.warning,
                    "Earth recovery after spatial tagging failure also failed "
                    "for activity %s (%s); existing tags are preserved when "
                    "present and ingestion continues",
                    activity_id,
                    type(recovery_exc).__name__,
                    exc_info=True,
                )
            )
            return 0
        return len(recovered_earth)

    def _observe_region_readiness(self, activity_id: int) -> None:
        """Log systemic fallback-data problems without altering ingestion."""
        try:
            with self._session.begin_nested():
                readiness = self._session.execute(
                    text(_REGION_READINESS_SQL)
                ).fetchone()
        except SQLAlchemyError as exc:
            log_best_effort(
                partial(
                    logger.warning,
                    "Regions table readiness check failed for activity %s (%s); "
                    "ingestion continues",
                    activity_id,
                    type(exc).__name__,
                    exc_info=True,
                )
            )
            return

        if readiness is None:
            log_best_effort(
                partial(
                    logger.warning,
                    "Regions table readiness check returned no row for activity %s; "
                    "ingestion continues",
                    activity_id,
                )
            )
            return

        specific_region_count, has_earth_region = readiness
        if specific_region_count < _MIN_SPECIFIC_REGIONS:
            log_best_effort(
                partial(
                    logger.error,
                    "Regions table appears unloaded or incomplete: only %d non-global "
                    "regions found (expected at least %d); activity %s used the earth "
                    "fallback (earth region present: %s)",
                    specific_region_count,
                    _MIN_SPECIFIC_REGIONS,
                    activity_id,
                    bool(has_earth_region),
                )
            )
        elif not has_earth_region:
            log_best_effort(
                partial(
                    logger.error,
                    "Earth fallback region is missing while tagging activity %s; "
                    "regions table is incomplete",
                    activity_id,
                )
            )

    def clear_activity_regions(self, activity_id: int) -> int:
        """Remove all region tags for an activity. Returns rows deleted.

        Used when an activity becomes virtual/indoor on an enriched UPDATE so it
        stops appearing on the map (zero region rows = non-geographic).
        """
        return _rowcount(
            self._session.execute(
                text(_DELETE_ACTIVITY_REGIONS_SQL),
                {"activity_id": activity_id},
            )
        )

    def exists(self, activity_id: int) -> bool:
        """Check if activity exists in database.

        Args:
            activity_id: Strava activity ID

        Returns:
            True if exists, False otherwise
        """
        query = text("""
            SELECT 1 FROM desirelines.activities WHERE id = :activity_id
        """)
        result = self._session.execute(query, {"activity_id": activity_id})
        return result.fetchone() is not None

    def get_existing_ids(self, activity_ids: list[int]) -> set[int]:
        """Filter a list of activity IDs, returning only the ones that exist.

        Args:
            activity_ids: List of Strava activity IDs to check

        Returns:
            Set of activity IDs that are already present in the database
        """
        if not activity_ids:
            return set()
        query = text("""
            SELECT id FROM desirelines.activities WHERE id = ANY(:ids)
        """)
        result = self._session.execute(query, {"ids": list(activity_ids)})
        return {row.id for row in result.fetchall()}

    def update_metadata(
        self, activity_id: int, updates: dict[str, Any], event_time: int | None
    ) -> MetadataUpdateResult:
        """Update only metadata fields (name, type, sport).

        Builds a dynamic UPDATE from whitelisted keys (SQL-injection safe) and
        fences it on ``last_event_time`` like ``upsert``. ``event_time`` advances
        the token via ``COALESCE`` (``None`` keeps the existing value and leaves
        the guard unfenced).

        A stale event and a missing row both update zero rows, so the outcome is
        classified in **one statement**: a locking ``target`` CTE reads existence
        and an ``upd`` CTE performs the guarded write, both under the same
        snapshot. This tells ``STALE`` apart from ``NOT_FOUND`` without a second
        ``exists()`` round-trip that a concurrently-committed CREATE could race.

        Args:
            activity_id: Strava activity ID
            updates: Dict with optional keys: 'title', 'type'
            event_time: webhook event_time (unix seconds); ``None`` skips fencing

        Returns:
            A :class:`MetadataUpdateResult` (``UPDATED`` / ``STALE`` /
            ``NOT_FOUND`` / ``NO_VALID_UPDATES``).

        Raises:
            ValueError: If updates contains unrecognized keys
        """
        # Validate all update keys are in the whitelist
        unknown_keys = set(updates.keys()) - set(_ALLOWED_UPDATE_CLAUSES.keys())
        if unknown_keys:
            raise ValueError(
                f"Unknown update keys: {unknown_keys}. "
                f"Allowed keys: {set(_ALLOWED_UPDATE_CLAUSES.keys())}"
            )

        set_clauses: list[str] = []
        params: dict[str, Any] = {"activity_id": activity_id}

        if "title" in updates:
            set_clauses.extend(_ALLOWED_UPDATE_CLAUSES["title"])
            params["name"] = updates["title"]

        if "type" in updates:
            # Update `type` only. Strava's UPDATE webhook sends the broad `type`
            # ("Ride"), not the granular `sport_type` ("MountainBikeRide") that
            # the `sport` column holds — so we deliberately leave `sport` intact
            # rather than clobber it with the lossy base type. When the
            # dispatcher re-fetches the activity on a type change, the enriched
            # path uses `upsert()` instead and refreshes `sport` correctly.
            set_clauses.extend(_ALLOWED_UPDATE_CLAUSES["type"])
            params["type"] = updates["type"]

        if not set_clauses:
            return MetadataUpdateResult.NO_VALID_UPDATES

        set_clauses.append("updated_at = :updated_at")
        params["updated_at"] = datetime.now(UTC)

        # Fence token: advance to the newer event_time (COALESCE keeps the old
        # value when event_time is None). Qualified `a.last_event_time` because
        # `target` also exposes the column.
        set_clauses.append("last_event_time = COALESCE(:event_time, a.last_event_time)")
        params["event_time"] = event_time

        # Single-statement existence-and-fence classification. `target` locks the
        # row (FOR UPDATE) and reports whether it exists; `upd` applies the write
        # only if the fence allows it. Both share the statement snapshot, so a
        # CREATE committing concurrently can't make a NOT_FOUND look STALE.
        # COALESCE(:event_time, target.last_event_time) makes an unfenced caller
        # (event_time NULL) compare the row to itself (always applies) and gives
        # :event_time a determinable type — a bare `:event_time IS NULL` would be
        # an AmbiguousParameter to Postgres.
        query = text(f"""
            WITH target AS (
                SELECT id, last_event_time
                FROM desirelines.activities
                WHERE id = :activity_id
                FOR UPDATE
            ),
            upd AS (
                UPDATE desirelines.activities AS a
                SET {", ".join(set_clauses)}
                FROM target
                WHERE a.id = target.id
                  AND (
                    target.last_event_time IS NULL
                    OR target.last_event_time
                       <= COALESCE(:event_time, target.last_event_time)
                  )
                RETURNING a.id
            )
            SELECT
                EXISTS (SELECT 1 FROM target) AS existed,
                EXISTS (SELECT 1 FROM upd) AS applied
        """)

        row = self._session.execute(query, params).fetchone()
        if row is None or not row.existed:
            return MetadataUpdateResult.NOT_FOUND
        return (
            MetadataUpdateResult.UPDATED if row.applied else MetadataUpdateResult.STALE
        )

    def delete(
        self, activity_id: int, event_time: int, correlation_id: str | None = None
    ) -> DeleteResult:
        """Delete activity by ID and record a deletion tombstone.

        Locks and reads the live row's ``last_event_time`` first: if the row is
        newer than this delete's ``event_time`` (a reordered/stale DELETE, e.g.
        arriving after a genuine re-creation), the delete is ignored — the row
        stays and no tombstone is written (``STALE``). Otherwise it upserts the
        ``deleted_activities`` tombstone (``GREATEST`` keeps the newest
        ``deletion_event_time``) and hard-deletes the row. The tombstone is
        written even when no live row exists (a DELETE before its CREATE), so
        ``insert``/``upsert`` can reject a later write that isn't strictly newer.
        All statements run in the caller's Unit of Work and commit together; the
        ``FOR UPDATE`` lock serializes concurrent writers on the row.

        Args:
            activity_id: Strava activity ID
            event_time: webhook event_time (unix seconds) of the delete
            correlation_id: trace id for the delete (stored for diagnostics)

        Returns:
            A :class:`DeleteResult` (``DELETED`` / ``NOT_FOUND`` / ``STALE``).
        """
        existing = self._session.execute(
            text(_SELECT_ACTIVITY_FENCE_FOR_UPDATE_SQL), {"activity_id": activity_id}
        ).fetchone()
        if (
            existing is not None
            and existing.last_event_time is not None
            and existing.last_event_time > event_time
        ):
            # Stale/reordered DELETE: the live row is newer. Leave it, and don't
            # write a tombstone that could block a legitimate future write.
            return DeleteResult.STALE

        self._session.execute(
            text(_TOMBSTONE_UPSERT_SQL),
            {
                "activity_id": activity_id,
                "event_time": event_time,
                "deleted_at": datetime.now(UTC),
                "correlation_id": correlation_id,
            },
        )
        result = self._session.execute(
            text(_DELETE_ACTIVITY_SQL), {"activity_id": activity_id}
        )
        return (
            DeleteResult.DELETED
            if result.fetchone() is not None
            else DeleteResult.NOT_FOUND
        )

    def delete_by_user(self, user_id: str) -> int:
        """Delete all activities for a user.

        activity_routes are cascade-deleted via FK (ON DELETE CASCADE).

        Args:
            user_id: Strava athlete ID (string)

        Returns:
            Count of deleted activity rows
        """
        query = text("""
            DELETE FROM desirelines.activities
            WHERE user_id = :user_id
        """)
        return _rowcount(self._session.execute(query, {"user_id": user_id}))
