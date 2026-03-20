"""Typed Pydantic response models for Cloud Run services.

Replaces ad-hoc dict response construction with validated models.
FastAPI automatically serializes these in HTTP responses.
"""

from pydantic import BaseModel, model_serializer

from stravapipe.shared.constants import ResponseStatus, SkipReason


class WebhookResponse(BaseModel):
    """Standard response for webhook event handlers.

    Covers success (created/updated/deleted), skipped, and processed responses.
    Optional fields are excluded from serialization when None.
    """

    status: ResponseStatus
    activity_id: int | None = None
    correlation_id: str | None = None
    reason: SkipReason | None = None
    details: str | None = None
    action: ResponseStatus | None = None

    @model_serializer(mode="wrap")
    def _exclude_none(self, handler):
        return {k: v for k, v in handler(self).items() if v is not None}


class HealthResponse(BaseModel):
    """Response for health check endpoints."""

    status: ResponseStatus


class UserDeletionResponse(BaseModel):
    """Response for user deletion (deauthorization) endpoint."""

    status: ResponseStatus
    correlation_id: str
    user_id: str
    pg_deleted: int
    bq_activities_deleted: int
    bq_staging_deleted: int
