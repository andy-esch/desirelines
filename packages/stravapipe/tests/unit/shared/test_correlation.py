"""Unit tests for the correlation ID + trace context propagation module."""

import logging

import pytest

from stravapipe.shared import correlation
from stravapipe.shared.correlation import (
    CorrelationFilter,
    apply_pubsub_request_context,
    extract_dispatcher_received_at_from_attributes,
    extract_trace_from_cloud_trace_header,
    extract_trace_from_pubsub_attributes,
    extract_trace_from_traceparent,
    get_correlation_id,
    get_delivery_attempt,
    get_dispatcher_received_at_ms,
    get_pubsub_message_id,
    get_trace_id,
    new_correlation_id,
    set_correlation_id,
    set_delivery_attempt,
    set_dispatcher_received_at_ms,
    set_pubsub_message_id,
    set_trace_context,
)


@pytest.fixture(autouse=True)
def _reset_contextvars():
    """Reset module-level contextvars between tests so state doesn't leak.

    ContextVars persist across tests within the same async context (pytest's
    default), so explicitly clearing them keeps tests independent.
    """
    set_correlation_id("")
    set_trace_context("", "", False)
    set_pubsub_message_id("")
    set_delivery_attempt(None)
    set_dispatcher_received_at_ms(None)
    yield
    set_correlation_id("")
    set_trace_context("", "", False)
    set_pubsub_message_id("")
    set_delivery_attempt(None)
    set_dispatcher_received_at_ms(None)


class TestCorrelationIdContextVar:
    def test_default_is_empty_string(self):
        assert get_correlation_id() == ""

    def test_set_and_get(self):
        set_correlation_id("abc-123")
        assert get_correlation_id() == "abc-123"

    def test_new_correlation_id_returns_uuid_and_sets_var(self):
        cid = new_correlation_id()
        # UUID4 string form is 36 characters with hyphens
        assert len(cid) == 36
        assert cid.count("-") == 4
        assert get_correlation_id() == cid

    def test_new_correlation_id_generates_unique_values(self):
        cids = {new_correlation_id() for _ in range(5)}
        assert len(cids) == 5


class TestTraceContextVar:
    def test_default_trace_id_is_empty(self):
        assert get_trace_id() == ""

    def test_set_trace_context(self):
        set_trace_context("0af7651916cd43dd8448eb211c80319c", "b7ad6b7169203331", True)
        assert get_trace_id() == "0af7651916cd43dd8448eb211c80319c"


class TestExtractTraceFromTraceparent:
    def test_valid_traceparent_sampled(self):
        header = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
        trace, span, sampled = extract_trace_from_traceparent(header)
        assert trace == "0af7651916cd43dd8448eb211c80319c"
        assert span == "b7ad6b7169203331"
        assert sampled is True

    def test_valid_traceparent_not_sampled(self):
        header = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00"
        trace, span, sampled = extract_trace_from_traceparent(header)
        assert trace == "0af7651916cd43dd8448eb211c80319c"
        assert span == "b7ad6b7169203331"
        assert sampled is False

    def test_empty_string_returns_empty(self):
        assert extract_trace_from_traceparent("") == ("", "", False)

    def test_malformed_returns_empty(self):
        assert extract_trace_from_traceparent("not-a-valid-traceparent") == (
            "",
            "",
            False,
        )

    def test_wrong_trace_length_returns_empty(self):
        # Trace must be exactly 32 hex chars
        assert extract_trace_from_traceparent("00-abc-b7ad6b7169203331-01") == (
            "",
            "",
            False,
        )


class TestExtractTraceFromCloudTraceHeader:
    def test_full_header(self):
        header = "0af7651916cd43dd8448eb211c80319c/12345;o=1"
        trace, span, sampled = extract_trace_from_cloud_trace_header(header)
        assert trace == "0af7651916cd43dd8448eb211c80319c"
        assert span == "12345"
        assert sampled is True

    def test_not_sampled(self):
        trace, span, sampled = extract_trace_from_cloud_trace_header("abc/1;o=0")
        assert trace == "abc"
        assert span == "1"
        assert sampled is False

    def test_no_span_no_options(self):
        trace, span, sampled = extract_trace_from_cloud_trace_header("abc")
        assert trace == "abc"
        assert span == ""
        assert sampled is False

    def test_empty_string_returns_empty(self):
        assert extract_trace_from_cloud_trace_header("") == ("", "", False)

    def test_malformed_returns_empty(self):
        assert extract_trace_from_cloud_trace_header("not valid!") == ("", "", False)


class TestExtractTraceFromPubsubAttributes:
    def test_extracts_traceparent(self):
        attrs = {
            "correlation_id": "abc",
            "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        }
        trace, span, sampled = extract_trace_from_pubsub_attributes(attrs)
        assert trace == "0af7651916cd43dd8448eb211c80319c"
        assert span == "b7ad6b7169203331"
        assert sampled is True

    def test_missing_traceparent_returns_empty(self):
        assert extract_trace_from_pubsub_attributes({"correlation_id": "x"}) == (
            "",
            "",
            False,
        )

    def test_empty_attributes(self):
        assert extract_trace_from_pubsub_attributes({}) == ("", "", False)


class TestCorrelationFilter:
    def _make_record(self) -> logging.LogRecord:
        return logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="hello",
            args=(),
            exc_info=None,
        )

    def test_filter_returns_true(self):
        f = CorrelationFilter()
        assert f.filter(self._make_record()) is True

    def test_injects_empty_correlation_id_when_unset(self):
        f = CorrelationFilter()
        record = self._make_record()
        f.filter(record)
        assert record.correlation_id == ""

    def test_injects_correlation_id_from_contextvar(self):
        set_correlation_id("trace-test-cid")
        f = CorrelationFilter()
        record = self._make_record()
        f.filter(record)
        assert record.correlation_id == "trace-test-cid"

    def test_mirrors_correlation_id_into_new_json_fields(self):
        # When no `extra=` was passed, the record has no json_fields. The
        # filter should create one so correlation_id reaches the structured
        # log payload (Cloud Logging only surfaces json_fields, not arbitrary
        # record attributes).
        set_correlation_id("cid-abc")
        f = CorrelationFilter()
        record = self._make_record()
        assert not hasattr(record, "json_fields")
        f.filter(record)
        assert record.json_fields == {"correlation_id": "cid-abc"}

    def test_mirrors_correlation_id_into_existing_json_fields(self):
        # When the JsonFieldsAdapter has already populated json_fields from
        # an `extra=` call, the filter should add to it without clobbering.
        set_correlation_id("cid-abc")
        f = CorrelationFilter()
        record = self._make_record()
        record.json_fields = {"rows_affected": 5}
        f.filter(record)
        assert record.json_fields == {
            "rows_affected": 5,
            "correlation_id": "cid-abc",
        }

    def test_does_not_overwrite_caller_supplied_correlation_id(self):
        # If the caller explicitly passed correlation_id in extra, respect it
        # over the contextvar — they had a reason to override.
        set_correlation_id("cid-from-context")
        f = CorrelationFilter()
        record = self._make_record()
        record.json_fields = {"correlation_id": "cid-explicit"}
        f.filter(record)
        assert record.json_fields["correlation_id"] == "cid-explicit"

    def test_no_json_fields_when_correlation_id_unset(self):
        # Empty correlation_id shouldn't pollute json_fields with empty strings.
        f = CorrelationFilter()
        record = self._make_record()
        f.filter(record)
        assert not hasattr(record, "json_fields")

    def test_does_not_set_trace_when_unset(self):
        f = CorrelationFilter()
        record = self._make_record()
        f.filter(record)
        assert not hasattr(record, "trace")

    def test_injects_raw_trace_id_when_no_project(self, monkeypatch):
        monkeypatch.setattr(correlation, "_GCP_PROJECT_ID", "")
        set_trace_context("0af7651916cd43dd8448eb211c80319c", "b7ad6b7169203331", True)
        f = CorrelationFilter()
        record = self._make_record()
        f.filter(record)
        assert record.trace == "0af7651916cd43dd8448eb211c80319c"
        assert record.span_id == "b7ad6b7169203331"
        assert record.trace_sampled is True

    def test_injects_resource_name_form_with_project(self, monkeypatch):
        monkeypatch.setattr(correlation, "_GCP_PROJECT_ID", "my-project")
        set_trace_context("0af7651916cd43dd8448eb211c80319c", "", False)
        f = CorrelationFilter()
        record = self._make_record()
        f.filter(record)
        assert (
            record.trace
            == "projects/my-project/traces/0af7651916cd43dd8448eb211c80319c"
        )
        # span_id is not set when empty
        assert not hasattr(record, "span_id")
        assert record.trace_sampled is False


class TestEndToEndLogRecord:
    """Verify CorrelationFilter actually attaches to a logger and tags records."""

    def test_filter_attached_to_logger_tags_records(self, caplog):
        caplog.set_level(logging.INFO)
        log = logging.getLogger("stravapipe.tests.correlation")
        f = CorrelationFilter()
        log.addFilter(f)
        try:
            new_correlation_id()
            log.info("hello world")
        finally:
            log.removeFilter(f)

        # The record should carry the contextvar-derived correlation_id
        rec = next(r for r in caplog.records if r.message == "hello world")
        assert rec.correlation_id == correlation.get_correlation_id()
        assert rec.correlation_id != ""


class TestInstallCorrelationFilter:
    """Verify the handler-level installation runs CorrelationFilter first.

    Order matters: ``CloudLoggingFilter`` (installed by Google's
    ``StructuredLogHandler``) reads ``record.trace`` to populate
    ``logging.googleapis.com/trace`` in the emitted JSON. CorrelationFilter
    must run first to set ``record.trace`` from the contextvar — appending
    it would silently drop trace context in production.
    """

    def test_correlation_filter_prepended_before_existing_filters(self):
        from stravapipe.shared.logging import _install_correlation_filter

        root = logging.getLogger()
        original_handlers = root.handlers[:]
        try:
            for h in original_handlers:
                root.removeHandler(h)

            handler = logging.StreamHandler()
            pre_existing = logging.Filter()
            handler.addFilter(pre_existing)
            root.addHandler(handler)

            _install_correlation_filter()

            # CorrelationFilter must be at index 0 so it runs before any
            # filter that reads record attributes it sets (record.trace).
            assert isinstance(handler.filters[0], CorrelationFilter)
            assert handler.filters[1] is pre_existing
        finally:
            for h in list(root.handlers):
                root.removeHandler(h)
            for h in original_handlers:
                root.addHandler(h)

    def test_install_is_idempotent(self):
        from stravapipe.shared.logging import _install_correlation_filter

        root = logging.getLogger()
        original_handlers = root.handlers[:]
        try:
            for h in original_handlers:
                root.removeHandler(h)
            handler = logging.StreamHandler()
            root.addHandler(handler)

            _install_correlation_filter()
            _install_correlation_filter()

            count = sum(isinstance(f, CorrelationFilter) for f in handler.filters)
            assert count == 1
        finally:
            for h in list(root.handlers):
                root.removeHandler(h)
            for h in original_handlers:
                root.addHandler(h)


class TestPubSubMessageIDContextVar:
    def test_default_is_empty_string(self):
        assert get_pubsub_message_id() == ""

    def test_set_and_get(self):
        set_pubsub_message_id("msg-123")
        assert get_pubsub_message_id() == "msg-123"


class TestDeliveryAttemptContextVar:
    def test_default_is_none(self):
        assert get_delivery_attempt() is None

    def test_set_and_get_int(self):
        set_delivery_attempt(3)
        assert get_delivery_attempt() == 3

    def test_set_and_get_none(self):
        set_delivery_attempt(2)
        set_delivery_attempt(None)
        assert get_delivery_attempt() is None


class TestCorrelationFilterPubSubFields:
    def _make_record(self) -> logging.LogRecord:
        return logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="hello",
            args=(),
            exc_info=None,
        )

    def test_mirrors_pubsub_message_id_into_json_fields(self):
        set_pubsub_message_id("msg-abc")
        f = CorrelationFilter()
        record = self._make_record()
        f.filter(record)
        assert record.json_fields == {"pubsub_message_id": "msg-abc"}

    def test_mirrors_delivery_attempt_into_json_fields(self):
        set_delivery_attempt(3)
        f = CorrelationFilter()
        record = self._make_record()
        f.filter(record)
        assert record.json_fields == {"delivery_attempt": 3}

    def test_omits_delivery_attempt_when_none(self):
        # First-delivery / no-DLQ case: field should not appear in payload at all.
        set_pubsub_message_id("msg-abc")
        f = CorrelationFilter()
        record = self._make_record()
        f.filter(record)
        assert "delivery_attempt" not in record.json_fields

    def test_includes_all_three_when_set(self):
        set_correlation_id("cid-1")
        set_pubsub_message_id("msg-abc")
        set_delivery_attempt(2)
        f = CorrelationFilter()
        record = self._make_record()
        f.filter(record)
        assert record.json_fields == {
            "correlation_id": "cid-1",
            "pubsub_message_id": "msg-abc",
            "delivery_attempt": 2,
        }

    def test_does_not_overwrite_caller_supplied_pubsub_fields(self):
        set_pubsub_message_id("cv-msg")
        set_delivery_attempt(1)
        f = CorrelationFilter()
        record = self._make_record()
        record.json_fields = {
            "pubsub_message_id": "explicit-msg",
            "delivery_attempt": 5,
        }
        f.filter(record)
        # setdefault semantics — explicit values win.
        assert record.json_fields["pubsub_message_id"] == "explicit-msg"
        assert record.json_fields["delivery_attempt"] == 5


class TestApplyPubSubRequestContext:
    def test_sets_all_three_contextvars(self):
        apply_pubsub_request_context("cid-1", "msg-2", 3)
        assert get_correlation_id() == "cid-1"
        assert get_pubsub_message_id() == "msg-2"
        assert get_delivery_attempt() == 3

    def test_returns_span_attrs_with_delivery_attempt_when_set(self):
        attrs = apply_pubsub_request_context("cid-1", "msg-2", 3)
        assert attrs == {
            "correlation_id": "cid-1",
            "pubsub.message_id": "msg-2",
            "pubsub.delivery_attempt": 3,
        }

    def test_omits_delivery_attempt_when_none(self):
        # First-delivery / no-DLQ case: must not appear in span attrs at all
        # so a Cloud Trace `pubsub.delivery_attempt > 1` filter cleanly
        # distinguishes retries from first-delivery messages.
        attrs = apply_pubsub_request_context("cid-1", "msg-2", None)
        assert "pubsub.delivery_attempt" not in attrs
        assert attrs == {"correlation_id": "cid-1", "pubsub.message_id": "msg-2"}
        # Contextvar still gets explicitly set to None so a leaked previous
        # value from another test/request doesn't bleed into log fields.
        assert get_delivery_attempt() is None


class TestDispatcherReceivedAtMs:
    """`dispatcher_received_at_unix_ms` parsing + contextvar plumbing.

    Anchors SLO 3 (data freshness): postgres-writer reads this on each
    successful insert to compute `now() - dispatcher_received_at` and
    record on `desirelines.io/webhook/end_to_end.duration`.
    """

    def test_extract_returns_int_for_valid_attribute(self):
        attrs = {"dispatcher_received_at_unix_ms": "1715347800123"}
        assert (
            extract_dispatcher_received_at_from_attributes(attrs) == 1715347800123
        )

    def test_extract_returns_none_when_missing(self):
        assert extract_dispatcher_received_at_from_attributes({}) is None

    def test_extract_returns_none_when_empty(self):
        assert (
            extract_dispatcher_received_at_from_attributes(
                {"dispatcher_received_at_unix_ms": ""}
            )
            is None
        )

    def test_extract_returns_none_for_unparseable(self):
        # Tolerant: a malformed attribute should not break ingest. Resulting
        # missing freshness measurement counts against SLO 3 as a failure.
        assert (
            extract_dispatcher_received_at_from_attributes(
                {"dispatcher_received_at_unix_ms": "not-a-number"}
            )
            is None
        )

    def test_set_and_get_round_trip(self):
        set_dispatcher_received_at_ms(1715347800123)
        assert get_dispatcher_received_at_ms() == 1715347800123

    def test_default_is_none(self):
        assert get_dispatcher_received_at_ms() is None
