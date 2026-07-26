"""PostgreSQL repository port for activity data.

Defines the contract for PostgreSQL-backed activity repository.
Only includes methods actually needed by the postgres_writer cloud function.

Error Handling Pattern:
    These methods return bool for "not found" scenarios instead of raising
    exceptions. This is intentional for webhook processing where:
    - Events can be duplicated (CREATE twice for same activity)
    - Events can arrive out of order (DELETE before CREATE)
    - Idempotency is preferred over strict error handling

    Compare to Strava adapters which raise ActivityNotFoundError on 404:
    - Strava 404 is unexpected (we only fetch when we expect it to exist)
    - Postgres "not found" is expected (activities predating our sync)
"""

from abc import ABC, abstractmethod
from enum import StrEnum
from typing import Any

from stravapipe.domain import StandardActivity


class InsertResult(StrEnum):
    """Outcome of ``ActivityRepository.insert`` (the CREATE path).

    ``RESURRECTION_BLOCKED`` (a tombstone for this id has a
    ``deletion_event_time`` >= the incoming CREATE's event_time) is distinguished
    from ``ALREADY_EXISTS`` so a prevented resurrection is observable. Both are
    classified atomically in one statement.
    """

    INSERTED = "inserted"
    ALREADY_EXISTS = "already_exists"
    RESURRECTION_BLOCKED = "resurrection_blocked"


class DeleteResult(StrEnum):
    """Outcome of ``ActivityRepository.delete`` (the DELETE path).

    ``STALE`` means the live row is newer than the delete's event_time (a
    reordered/stale DELETE), so the row is left intact and no tombstone is
    written. ``DELETED`` and ``NOT_FOUND`` both write/refresh the tombstone.
    """

    DELETED = "deleted"
    NOT_FOUND = "not_found"
    STALE = "stale"


class MetadataUpdateResult(StrEnum):
    """Outcome of ``ActivityRepository.update_metadata``.

    Distinguishes the three DB outcomes that a plain bool conflates — in
    particular ``STALE`` (row present, event_time older than the stored fence)
    versus ``NOT_FOUND`` (no such row). These are resolved atomically in one
    statement so a concurrent CREATE can't flip the classification.
    """

    UPDATED = "updated"
    STALE = "stale"
    NOT_FOUND = "not_found"
    NO_VALID_UPDATES = "no_valid_updates"


class ActivityRepository(ABC):
    """Repository for PostgreSQL activity operations.

    This port is used with the Unit of Work pattern - implementations
    receive their database session from the UoW, not from __init__.

    Methods return bool for success/not-found to support idempotent webhook
    processing. Database errors still raise exceptions.
    """

    @abstractmethod
    def insert(
        self, activity: StandardActivity, event_time: int | None
    ) -> InsertResult:
        """Insert activity to PostgreSQL, ignore if already exists.

        Used for CREATE webhooks - writes all activity fields.
        Uses ON CONFLICT DO NOTHING - duplicates are not errors. Also rejects a
        CREATE whose ``event_time`` is not strictly newer than an existing
        deletion tombstone (see ``delete``), so a late/reordered CREATE cannot
        resurrect a deleted activity. Records ``event_time`` as the
        ``last_event_time`` fence token so a later UPDATE can reject events older
        than this CREATE. Existence, the tombstone check, and the write are
        classified in one statement (no race with a concurrent delete).

        Args:
            activity: StandardActivity domain model
            event_time: webhook event_time (unix seconds). ``None`` (backfill)
                stores a NULL token and skips the tombstone guard — the row stays
                unfenced until a live write sets one.

        Returns:
            An :class:`InsertResult` (``INSERTED`` / ``ALREADY_EXISTS`` /
            ``RESURRECTION_BLOCKED``).
        """
        raise NotImplementedError

    @abstractmethod
    def upsert(self, activity: StandardActivity, event_time: int | None) -> bool:
        """Insert activity, or refresh every column if it already exists.

        Used for enriched UPDATE webhooks (a type change), where the dispatcher
        re-fetched the full Strava activity so we can recover the granular
        ``sport_type`` the webhook omits, and for backfill. Unlike ``insert``
        (ON CONFLICT DO NOTHING), this refreshes all columns from authoritative
        Strava data, preserving the original ``created_at``.

        The conflict branch is fenced on ``last_event_time``: a live event older
        than the stored token is rejected (returns False). ``event_time=None``
        (backfill) is unfenced and never advances the token.

        Args:
            activity: StandardActivity domain model (full, freshly fetched)
            event_time: webhook event_time (unix seconds). ``None`` (backfill)
                disables fencing (the write applies unconditionally) and
                preserves — never advances or wipes — the stored token.

        Returns:
            True if the row was inserted or updated; False if a stale live event
            was rejected by the fence guard.
        """
        raise NotImplementedError

    @abstractmethod
    def exists(self, activity_id: int) -> bool:
        """Check if activity exists in database.

        Used by UPDATE handler to determine if activity needs to be
        fetched from Strava (for activities predating our PostgreSQL setup).

        Args:
            activity_id: Strava activity ID

        Returns:
            True if exists, False otherwise
        """
        raise NotImplementedError

    @abstractmethod
    def get_existing_ids(self, activity_ids: list[int]) -> set[int]:
        """Filter a list of activity IDs, returning only the ones that exist.

        Used in batch processing to separate inserts and updates efficiently.

        Args:
            activity_ids: List of Strava activity IDs to check

        Returns:
            Set of activity IDs that are already present in the database
        """
        raise NotImplementedError

    @abstractmethod
    def update_metadata(
        self, activity_id: int, updates: dict[str, Any], event_time: int | None
    ) -> MetadataUpdateResult:
        """Update only metadata fields (name, type, sport).

        Used for UPDATE webhooks - only updates changed fields.
        Does NOT require fetching from Strava API. Fenced on ``last_event_time``
        and classified atomically in one statement, so ``STALE`` (row present,
        event older than the stored token) is never confused with ``NOT_FOUND``
        even if a CREATE commits concurrently. ``event_time=None`` disables
        fencing (applies unconditionally) and preserves the stored token.

        Args:
            activity_id: Strava activity ID
            updates: Dict with optional keys: 'title', 'type'
            event_time: webhook event_time (unix seconds); ``None`` skips fencing

        Returns:
            A :class:`MetadataUpdateResult`: ``UPDATED``, ``STALE`` (fence
            rejected), ``NOT_FOUND``, or ``NO_VALID_UPDATES`` (empty/unrecognized
            updates).

        Raises:
            ValueError: If updates contains unrecognized keys
        """
        raise NotImplementedError

    @abstractmethod
    def insert_route(self, activity_id: int, geojson: str) -> bool:
        """Insert activity route geometry, ignore if already exists.

        Uses ON CONFLICT DO NOTHING to match activity insert behavior.

        Args:
            activity_id: Strava activity ID (must exist in activities table)
            geojson: GeoJSON LineString string for ST_GeomFromGeoJSON()

        Returns:
            True if inserted, False if already existed (conflict)
        """
        raise NotImplementedError

    @abstractmethod
    def tag_activity_regions(self, activity_id: int) -> int:
        """Tag an activity with every region its route intersects (many-to-many).

        Writes ``activity_regions`` rows for each region the route linestring
        intersects, falling back to the builtin ``earth`` region when the route
        matches no specific boundary. Idempotent and atomic (clears and rewrites
        inside a savepoint, preserving existing tags on a transient failure).
        Must only be called for geo-bearing (non-virtual/indoor) activities. A
        route may already exist, may have been written in the current transaction,
        or may be absent (in which case the method clears stale tags and returns 0).
        If spatial matching fails for a newly inserted routed activity, the
        implementation may recover it to the global fallback without replacing
        any tags restored by the savepoint rollback.

        Args:
            activity_id: Strava activity ID

        Returns:
            Number of region rows written (0 if the activity has no route)
        """
        raise NotImplementedError

    @abstractmethod
    def clear_activity_regions(self, activity_id: int) -> int:
        """Remove all region tags for an activity.

        Used on the enriched UPDATE path when an activity becomes virtual/indoor
        (a Strava type change), so a now-non-geographic activity stops appearing
        on the map.

        Args:
            activity_id: Strava activity ID

        Returns:
            Number of region rows deleted
        """
        raise NotImplementedError

    @abstractmethod
    def delete(
        self, activity_id: int, event_time: int, correlation_id: str | None = None
    ) -> DeleteResult:
        """Delete activity by ID and record a deletion tombstone.

        Used for DELETE webhooks - hard delete of the activity row plus an
        upsert into ``deleted_activities`` carrying the delete's ``event_time``.
        The tombstone is written even when no live row exists (a DELETE that
        arrives before its CREATE), so a later CREATE not strictly newer than
        ``event_time`` is rejected by ``insert`` and cannot resurrect the
        activity. On a repeated/reordered delete the tombstone keeps the newest
        ``event_time``.

        Fenced on ``last_event_time``: if the live row is newer than
        ``event_time`` (a reordered/stale DELETE, e.g. arriving after a genuine
        re-creation), the row is left intact and no tombstone is written
        (``STALE``). The row read is locked ``FOR UPDATE`` to serialize
        concurrent writers.

        Args:
            activity_id: Strava activity ID
            event_time: webhook event_time (unix seconds) of the delete; stored
                as the tombstone's ``deletion_event_time``
            correlation_id: trace id for the delete, stored for diagnostics

        Returns:
            A :class:`DeleteResult` (``DELETED`` / ``NOT_FOUND`` / ``STALE``).
        """
        raise NotImplementedError

    @abstractmethod
    def delete_by_user(self, user_id: str) -> int:
        """Delete all activities for a user.

        Used for user deauthorization — hard delete of all user data.
        activity_routes are cascade-deleted via FK (ON DELETE CASCADE).

        Args:
            user_id: Strava athlete ID (string)

        Returns:
            Count of deleted activity rows
        """
        raise NotImplementedError
