"""Correlation ID and trace context propagation via contextvars.

Provides a ``ContextVar``-based correlation ID and trace context that is
automatically attached to every log record by ``CorrelationFilter``. This
mirrors the Go side's ``chi/middleware.RequestID`` + Cloud Trace context
extraction pattern in ``packages/shared/gcplog/middleware.go``.

Usage in a Cloud Run handler::

    from stravapipe.shared.correlation import (
        new_correlation_id,
        set_correlation_id,
        set_trace_context,
        extract_trace_from_pubsub_attributes,
    )

    correlation_id = attributes.get("correlation_id") or new_correlation_id()
    set_correlation_id(correlation_id)

    trace_id = extract_trace_from_pubsub_attributes(attributes)
    if trace_id:
        set_trace_context(trace_id)

After ``setup_logging()`` has registered ``CorrelationFilter`` on the root
logger, every subsequent log call will carry ``correlation_id`` and (when
present) ``logging.googleapis.com/trace`` automatically — no need to pass
``extra={"correlation_id": ...}`` on each call.
"""

import contextvars
import logging
import os
import re
from typing import Any
import uuid

# Module-level ContextVars. Default to empty string so the filter can
# unconditionally set record attributes without raising LookupError.
_correlation_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "correlation_id", default=""
)
_trace_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "trace_id", default=""
)
_span_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "span_id", default=""
)
_trace_sampled_var: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "trace_sampled", default=False
)
# Pub/Sub broker-side identifiers — see set_pubsub_message_id /
# set_delivery_attempt for usage. Both default to empty / None so the filter
# can read them unconditionally without LookupError.
_pubsub_message_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "pubsub_message_id", default=""
)
_delivery_attempt_var: contextvars.ContextVar[int | None] = contextvars.ContextVar(
    "delivery_attempt", default=None
)

# Matches GCP's X-Cloud-Trace-Context header: TRACE_ID/SPAN_ID;o=TRACE_TRUE
# (SPAN_ID and ;o= are optional)
_CLOUD_TRACE_RE = re.compile(
    r"^(?P<trace>[0-9a-fA-F]+)(?:/(?P<span>\d+))?(?:;o=(?P<sampled>[01]))?$"
)

# Matches W3C traceparent: VERSION-TRACE_ID-PARENT_ID-FLAGS
_TRACEPARENT_RE = re.compile(
    r"^(?P<version>[0-9a-fA-F]{2})-"
    r"(?P<trace>[0-9a-fA-F]{32})-"
    r"(?P<span>[0-9a-fA-F]{16})-"
    r"(?P<flags>[0-9a-fA-F]{2})$"
)

# Cache GCP project ID for trace formatting.
_GCP_PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get(
    "GCP_PROJECT", ""
)


def get_correlation_id() -> str:
    """Return the current correlation ID, or empty string if not set."""
    return _correlation_id_var.get()


def set_correlation_id(cid: str) -> contextvars.Token[str]:
    """Set the current correlation ID and return the token for resetting."""
    return _correlation_id_var.set(cid)


def new_correlation_id() -> str:
    """Generate a new UUIDv4 correlation ID, set it, and return it."""
    cid = str(uuid.uuid4())
    _correlation_id_var.set(cid)
    return cid


def set_trace_context(
    trace_id: str,
    span_id: str = "",
    sampled: bool = False,
) -> None:
    """Set the current trace context for log correlation.

    ``trace_id`` is expected to be the raw hex trace identifier. The logging
    filter formats it into Cloud Logging's resource-name form
    (``projects/<project>/traces/<trace>``) using the ``GOOGLE_CLOUD_PROJECT``
    or ``GCP_PROJECT`` environment variable when available.
    """
    _trace_id_var.set(trace_id)
    _span_id_var.set(span_id)
    _trace_sampled_var.set(sampled)


def get_trace_id() -> str:
    """Return the current raw trace ID, or empty string if not set."""
    return _trace_id_var.get()


def set_pubsub_message_id(message_id: str) -> contextvars.Token[str]:
    """Set the broker-assigned Pub/Sub message_id for the current request.

    The value is auto-attached to every subsequent log record by
    ``CorrelationFilter`` so a single Cloud Logging filter
    ``jsonPayload.pubsub_message_id="..."`` returns every log line for one
    specific delivery — essential for diagnosing redelivery patterns.
    """
    return _pubsub_message_id_var.set(message_id)


def get_pubsub_message_id() -> str:
    """Return the current Pub/Sub message_id, or empty string if not set."""
    return _pubsub_message_id_var.get()


def set_delivery_attempt(attempt: int | None) -> contextvars.Token[int | None]:
    """Set the Pub/Sub `deliveryAttempt` for the current request.

    Pass ``None`` for first-delivery / no-DLQ messages where the field is
    absent on the envelope; the filter then omits it from log payloads. Pass
    an int (typically ≥ 1) when the envelope carried the field — the same
    int is logged on every record for the request, so a Cloud Logging filter
    ``jsonPayload.delivery_attempt > 1`` surfaces only retried deliveries.
    """
    return _delivery_attempt_var.set(attempt)


def get_delivery_attempt() -> int | None:
    """Return the current delivery attempt, or None if unset / first delivery."""
    return _delivery_attempt_var.get()


def apply_pubsub_request_context(
    correlation_id: str,
    pubsub_message_id: str,
    delivery_attempt: int | None,
) -> dict[str, Any]:
    """Wire request-scoped Pub/Sub identifiers and return matching span attrs.

    Centralizes the "set 3 contextvars + build span_attrs dict" pattern shared
    by every Pub/Sub-consuming Cloud Run handler in stravapipe. After this
    returns, ``CorrelationFilter`` will mirror all three values into every
    subsequent log record's ``json_fields``, and the returned dict is in the
    shape that ``record_span(attributes=...)`` expects.

    Takes primitives (not ``CloudEventContext``) so this module stays free of
    a dependency on ``cloudrun.pubsub``.

    ``delivery_attempt`` is omitted from the returned dict when ``None`` so a
    Cloud Trace filter ``pubsub.delivery_attempt > 1`` cleanly distinguishes
    retried deliveries from first-delivery messages.
    """
    set_correlation_id(correlation_id)
    set_pubsub_message_id(pubsub_message_id)
    set_delivery_attempt(delivery_attempt)
    attrs: dict[str, str | int] = {
        "correlation_id": correlation_id,
        "pubsub.message_id": pubsub_message_id,
    }
    if delivery_attempt is not None:
        attrs["pubsub.delivery_attempt"] = delivery_attempt
    return attrs


def extract_trace_from_cloud_trace_header(header: str) -> tuple[str, str, bool]:
    """Parse GCP's X-Cloud-Trace-Context header.

    Format: ``TRACE_ID/SPAN_ID;o=TRACE_TRUE`` (SPAN_ID and ``;o=`` optional).
    Returns ``(trace_id, span_id, sampled)``. On parse failure returns
    empty strings and ``False``.
    """
    if not header:
        return "", "", False
    match = _CLOUD_TRACE_RE.match(header.strip())
    if match is None:
        return "", "", False
    return (
        match.group("trace") or "",
        match.group("span") or "",
        match.group("sampled") == "1",
    )


def extract_trace_from_traceparent(header: str) -> tuple[str, str, bool]:
    """Parse W3C ``traceparent`` header.

    Format: ``VERSION-TRACE_ID-PARENT_ID-FLAGS`` (e.g. ``00-<32hex>-<16hex>-01``).
    Returns ``(trace_id, span_id, sampled)``. On parse failure returns
    empty strings and ``False``.
    """
    if not header:
        return "", "", False
    match = _TRACEPARENT_RE.match(header.strip())
    if match is None:
        return "", "", False
    flags = match.group("flags")
    sampled = bool(flags) and (int(flags, 16) & 0x01) == 0x01
    return match.group("trace"), match.group("span"), sampled


def extract_trace_from_pubsub_attributes(
    attributes: dict[str, str],
) -> tuple[str, str, bool]:
    """Extract trace context from a PubSub message's attribute map.

    The Go dispatcher injects W3C ``traceparent`` into outgoing PubSub
    messages (see ``packages/dispatcher/adapters/pubsub/publisher.go:142``).
    Returns ``(trace_id, span_id, sampled)``; all empty / False if absent.
    """
    return extract_trace_from_traceparent(attributes.get("traceparent", ""))


def _format_gcp_trace(trace_id: str) -> str:
    """Format a raw trace ID into Cloud Logging's resource-name form.

    Returns ``projects/<project>/traces/<trace_id>`` when a project ID is
    discoverable from the environment, otherwise the raw trace ID. Cloud
    Logging requires the resource-name form to link logs to traces in the
    Cloud Console.
    """
    if not _GCP_PROJECT_ID:
        return trace_id
    return f"projects/{_GCP_PROJECT_ID}/traces/{trace_id}"


class CorrelationFilter(logging.Filter):
    """Auto-injects correlation ID and trace context into every log record.

    Sets the following record attributes, consumed by google-cloud-logging's
    structured-log handler:

    - ``trace`` / ``span_id`` / ``trace_sampled`` — reserved attributes that
      ``CloudLoggingFilter`` reads to emit ``logging.googleapis.com/trace``
      etc. in the structured JSON payload. Set only when a trace ID is
      available; ``trace`` is formatted as
      ``projects/<project>/traces/<trace_id>`` for Cloud Logging trace linking.
    - ``correlation_id`` — set on the record for in-process introspection,
      *and* mirrored into ``record.json_fields`` so it actually reaches the
      structured ``jsonPayload`` (custom attributes on the record itself are
      not surfaced by Cloud Logging — only ``json_fields`` is).

    The filter never drops records (always returns True).
    """

    def filter(self, record: logging.LogRecord) -> bool:
        correlation_id = _correlation_id_var.get()
        record.correlation_id = correlation_id

        # Cloud Logging only surfaces fields from `record.json_fields`, not
        # arbitrary record attributes. Mirror non-empty correlation IDs in so
        # they appear in the emitted jsonPayload. JsonFieldsAdapter creates
        # `json_fields` when the caller passes `extra=`; we lazily create it
        # otherwise so callers without `extra=` still get a tagged record.
        pubsub_message_id = _pubsub_message_id_var.get()
        delivery_attempt = _delivery_attempt_var.get()
        if correlation_id or pubsub_message_id or delivery_attempt is not None:
            existing = getattr(record, "json_fields", None)
            if not isinstance(existing, dict):
                existing = {}
                record.json_fields = existing
            if correlation_id:
                existing.setdefault("correlation_id", correlation_id)
            if pubsub_message_id:
                existing.setdefault("pubsub_message_id", pubsub_message_id)
            if delivery_attempt is not None:
                existing.setdefault("delivery_attempt", delivery_attempt)

        trace_id = _trace_id_var.get()
        if trace_id:
            # google-cloud-logging reads `record.trace` and emits it as
            # `logging.googleapis.com/trace` in the structured JSON payload.
            record.trace = _format_gcp_trace(trace_id)
            span_id = _span_id_var.get()
            if span_id:
                record.span_id = span_id
            record.trace_sampled = _trace_sampled_var.get()
        return True
