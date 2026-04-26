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

from __future__ import annotations

import contextvars
import logging
import os
import re
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
    project_id = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get(
        "GCP_PROJECT", ""
    )
    if not project_id:
        return trace_id
    return f"projects/{project_id}/traces/{trace_id}"


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
        if correlation_id:
            existing = getattr(record, "json_fields", None)
            if isinstance(existing, dict):
                existing.setdefault("correlation_id", correlation_id)
            else:
                record.json_fields = {"correlation_id": correlation_id}

        trace_id = _trace_id_var.get()
        if trace_id:
            record.trace = _format_gcp_trace(trace_id)
            span_id = _span_id_var.get()
            if span_id:
                record.span_id = span_id
            record.trace_sampled = _trace_sampled_var.get()
        return True
