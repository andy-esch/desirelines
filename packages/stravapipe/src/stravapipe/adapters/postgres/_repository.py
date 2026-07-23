"""SQLAlchemy repository for PostgreSQL activity storage.

Uses raw SQL via sa.text() for simple, efficient queries.
Repository receives Session from Unit of Work - doesn't manage its own connection.
"""

from datetime import UTC, datetime
import logging
from typing import Any, Final, cast

from sqlalchemy import text
from sqlalchemy.engine import CursorResult, Result
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from stravapipe.domain import StandardActivity
from stravapipe.ports.out.postgres import ActivityRepository

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

# Columns for a full activity write, in INSERT order. Single source of truth so
# `insert` and `upsert` can't drift when a column is added — adding one here
# (plus a line in `_activity_write_params`) updates both SQL statements and the
# upsert SET clause below. `id` and `created_at` are insert-only: never in the
# ON CONFLICT DO UPDATE SET, so the original `created_at` survives an upsert.
_ACTIVITY_COLUMNS: Final[tuple[str, ...]] = (
    "id",
    "user_id",
    "name",
    "type",
    "sport",
    "start_date_local",
    "distance",
    "moving_time",
    "elapsed_time",
    "total_elevation_gain",
    "average_speed",
    "max_speed",
    "average_heartrate",
    "max_heartrate",
    "trainer",
    "manual",
    "year",
    "created_at",
    "updated_at",
)
_ACTIVITY_INSERT_ONLY_COLUMNS: Final[frozenset[str]] = frozenset({"id", "created_at"})

_ACTIVITY_INSERT_SQL: Final[str] = (
    f"INSERT INTO desirelines.activities ({', '.join(_ACTIVITY_COLUMNS)}) "
    f"VALUES ({', '.join(f':{col}' for col in _ACTIVITY_COLUMNS)})"
)
_ACTIVITY_UPSERT_SET_SQL: Final[str] = ", ".join(
    f"{col} = EXCLUDED.{col}"
    for col in _ACTIVITY_COLUMNS
    if col not in _ACTIVITY_INSERT_ONLY_COLUMNS
)

_DELETE_ACTIVITY_REGIONS_SQL: Final[str] = (
    "DELETE FROM desirelines.activity_regions WHERE activity_id = :activity_id"
)


def _activity_write_params(activity: StandardActivity, now: datetime) -> dict[str, Any]:
    """Bind params for a full activity write (``insert`` / ``upsert``).

    ``created_at`` and ``updated_at`` are both set to ``now``; on an upsert
    conflict ``created_at`` isn't in the SET clause, so the original is kept.
    """
    return {
        "id": activity.id,
        "user_id": activity.user_id,
        "name": activity.name,
        "type": activity.type,
        "sport": activity.sport,
        "start_date_local": activity.start_date_local,
        "distance": activity.distance,
        "moving_time": activity.moving_time,
        "elapsed_time": activity.elapsed_time,
        "total_elevation_gain": activity.total_elevation_gain,
        "average_speed": activity.average_speed,
        "max_speed": activity.max_speed,
        "average_heartrate": activity.average_heartrate,
        "max_heartrate": activity.max_heartrate,
        "trainer": activity.trainer,
        "manual": activity.manual,
        "year": activity.year,
        "created_at": now,
        "updated_at": now,
    }


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

    def insert(self, activity: StandardActivity) -> bool:
        """Insert activity, ignore if already exists.

        Uses ON CONFLICT DO NOTHING - duplicates are not errors.

        Args:
            activity: StandardActivity domain model

        Returns:
            True if inserted, False if already existed (conflict)
        """
        query = text(f"{_ACTIVITY_INSERT_SQL} ON CONFLICT (id) DO NOTHING RETURNING id")
        result = self._session.execute(
            query, _activity_write_params(activity, datetime.now(UTC))
        )
        # RETURNING id only returns a row if insert happened (not on conflict)
        return result.fetchone() is not None

    def upsert(self, activity: StandardActivity) -> bool:
        """Insert activity, or refresh every column if it already exists.

        Used for enriched UPDATE webhooks (a type change) where the dispatcher
        re-fetched the full Strava activity. ON CONFLICT DO UPDATE refreshes all
        columns from authoritative Strava data, preserving the original
        `created_at`. Always affects one row, so always returns True.

        Routes are intentionally not touched here: a type change doesn't alter
        geometry, and the route was written on CREATE. (In the rare case the
        row is *inserted* here — a type-change UPDATE arriving before its
        CREATE — the route is left unpopulated; a later re-sync/backfill covers
        that edge.)
        """
        query = text(
            f"{_ACTIVITY_INSERT_SQL} "
            f"ON CONFLICT (id) DO UPDATE SET {_ACTIVITY_UPSERT_SET_SQL} "
            f"RETURNING id"
        )
        result = self._session.execute(
            query, _activity_write_params(activity, datetime.now(UTC))
        )
        return result.fetchone() is not None

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

        Idempotent: clears the activity's existing tags first, so re-tagging (a
        backfill, or a boundary-dataset reload) is safe.

        Resilience: the spatial join runs inside a SAVEPOINT. If it fails (a
        pathological geometry, a statement timeout on a very long route), we roll
        back just the savepoint, log a warning, and fall through to the ``earth``
        global fallback — so the activity is still tagged (and visible on the map's
        global view) and the surrounding activity insert is never aborted.

        The caller must NOT call this for virtual/indoor activities — their
        geometry is absent or fake (Zwift's polyline is a virtual world), so they
        belong in the complementary non-map view with zero region rows.

        Args:
            activity_id: Strava activity ID (its route must already be written
                in the same transaction).

        Returns:
            Number of region rows written (0 if the activity has no route).
        """
        self._session.execute(
            text(_DELETE_ACTIVITY_REGIONS_SQL),
            {"activity_id": activity_id},
        )

        # Specific regions: every non-fallback boundary the route intersects.
        # Savepoint-isolated so a spatial failure degrades to the 'earth' fallback
        # with a warning instead of poisoning the activity-insert transaction.
        specific: list[Any] = []
        try:
            with self._session.begin_nested():
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
        except SQLAlchemyError:
            specific = []
            logger.warning(
                "Region spatial tagging failed for activity %s; "
                "falling back to 'earth'",
                activity_id,
                exc_info=True,
            )
        if specific:
            return len(specific)

        # Fallback: tag the builtin 'earth' region, but only if the activity
        # actually has a route (no route -> no geography -> stays untagged).
        earth = self._session.execute(
            text("""
                INSERT INTO desirelines.activity_regions (activity_id, region_id)
                SELECT :activity_id, re.id
                FROM desirelines.regions re
                WHERE re.source = 'builtin'
                  AND re.region_code = 'earth'
                  AND EXISTS (
                      SELECT 1 FROM desirelines.activity_routes
                      WHERE activity_id = :activity_id
                  )
                RETURNING region_id
            """),
            {"activity_id": activity_id},
        ).fetchall()
        return len(earth)

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

    def update_metadata(self, activity_id: int, updates: dict[str, Any]) -> bool | None:
        """Update only metadata fields (name, type, sport).

        Builds dynamic UPDATE query based on which fields changed.
        Only allows whitelisted update keys to prevent SQL injection.

        Args:
            activity_id: Strava activity ID
            updates: Dict with optional keys: 'title', 'type'

        Returns:
            True if updated successfully
            False if activity not found
            None if no valid updates provided (empty dict or no recognized keys)

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
            return None  # No valid updates provided

        set_clauses.append("updated_at = :updated_at")
        params["updated_at"] = datetime.now(UTC)

        query = text(f"""
            UPDATE desirelines.activities
            SET {", ".join(set_clauses)}
            WHERE id = :activity_id
            RETURNING id
        """)

        result = self._session.execute(query, params)
        return result.fetchone() is not None

    def delete(self, activity_id: int) -> bool:
        """Delete activity by ID.

        Args:
            activity_id: Strava activity ID

        Returns:
            True if deleted, False if not found
        """
        query = text("""
            DELETE FROM desirelines.activities
            WHERE id = :activity_id
            RETURNING id
        """)
        result = self._session.execute(query, {"activity_id": activity_id})
        return result.fetchone() is not None

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
