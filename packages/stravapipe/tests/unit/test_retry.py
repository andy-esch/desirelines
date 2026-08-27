"""Tests for retry logic."""

from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from unittest.mock import Mock, patch

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
import pytest
import requests

from stravapipe.exceptions import StravaRateLimitError
from stravapipe.retry import (
    RATE_LIMIT_JITTER_SECONDS,
    _parse_retry_after,
    retry_on_failure,
)


class TestRetryOnFailure:
    """Test the retry_on_failure decorator."""

    def test_successful_call_no_retry(self):
        """Test that successful calls don't trigger retries."""

        @retry_on_failure(max_attempts=3)
        def successful_func():
            return "success"

        result = successful_func()
        assert result == "success"

    def test_network_error_retries(self):
        """Test that network errors trigger retries."""
        call_count = 0

        @retry_on_failure(max_attempts=3, backoff_seconds=0.01)
        def failing_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise requests.exceptions.ConnectionError("Network error")
            return "success"

        result = failing_func()
        assert result == "success"
        assert call_count == 3

    def test_timeout_error_retries(self):
        """Test that timeout errors trigger retries."""
        call_count = 0

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def timeout_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise requests.exceptions.Timeout("Request timeout")
            return "success"

        result = timeout_func()
        assert result == "success"
        assert call_count == 2

    def test_http_error_500_retries(self):
        """Test that 500 errors trigger retries."""
        call_count = 0

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def server_error_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                response = Mock()
                response.status_code = 500
                error = requests.exceptions.HTTPError("Server error")
                error.response = response
                raise error
            return "success"

        result = server_error_func()
        assert result == "success"
        assert call_count == 2

    def test_http_error_404_no_retry(self):
        """Test that 404 errors don't trigger retries."""

        @retry_on_failure(max_attempts=3)
        def not_found_func():
            response = Mock()
            response.status_code = 404
            error = requests.exceptions.HTTPError("Not found")
            error.response = response
            raise error

        with pytest.raises(requests.exceptions.HTTPError):
            not_found_func()

    def test_rate_limit_429_with_retry_after(self):
        """Test rate limiting with Retry-After header."""
        call_count = 0

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def rate_limited_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                response = Mock()
                response.status_code = 429
                response.headers = {"Retry-After": "1"}
                error = requests.exceptions.HTTPError("Rate limited")
                error.response = response
                raise error
            return "success"

        with patch("time.sleep") as mock_sleep:
            result = rate_limited_func()
            assert result == "success"
            assert call_count == 2
            # Retry-After is a floor, not an exact sleep: RATE_LIMIT_JITTER_SECONDS
            # is added on top so concurrent rate-limited workers don't wake in
            # lockstep. Never sleep less than the server asked for.
            (slept,) = mock_sleep.call_args.args
            assert 1 <= slept <= 1 + RATE_LIMIT_JITTER_SECONDS

    def test_rate_limit_429_exceeds_max_attempts(self):
        """Test rate limiting that exceeds max attempts."""

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def always_rate_limited():
            response = Mock()
            response.status_code = 429
            response.headers = {"Retry-After": "60"}
            error = requests.exceptions.HTTPError("Rate limited")
            error.response = response
            raise error

        with patch("time.sleep"), pytest.raises(StravaRateLimitError) as exc_info:
            always_rate_limited()

        assert "Rate limit exceeded after 2 attempts" in str(exc_info.value)
        assert exc_info.value.retry_after == 60

    def test_rate_limit_429_no_retry_after_header(self):
        """Test rate limiting without Retry-After header uses default."""
        call_count = 0

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def rate_limited_no_header():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                response = Mock()
                response.status_code = 429
                response.headers = {}  # No Retry-After header
                error = requests.exceptions.HTTPError("Rate limited")
                error.response = response
                raise error
            return "success"

        with patch("time.sleep") as mock_sleep:
            result = rate_limited_no_header()
            assert result == "success"
            # 60s default fallback, plus the anti-lockstep jitter.
            (slept,) = mock_sleep.call_args.args
            assert 60 <= slept <= 60 + RATE_LIMIT_JITTER_SECONDS

    def test_rate_limit_jitter_desynchronises_and_never_undercuts_retry_after(self):
        """429 backoff spreads wakeups without ever retrying early.

        The 5xx path uses AWS full jitter (sample from ``[0, nominal)``) because
        it invents its own delay. ``Retry-After`` is different: it is the server
        stating the earliest acceptable retry, so sampling below it would retry
        early and earn another 429. The jitter is therefore additive — a floor of
        ``retry_after`` with a bounded spread above it.

        Regression for audit 2026-07-30-stravapipe L1: this path previously slept
        exactly ``Retry-After``, so every rate-limited worker woke on the same
        instant and re-tripped the limit together.
        """
        retry_after = 30
        observed: list[float] = []

        for _ in range(40):
            call_count = 0

            @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
            def rate_limited():
                nonlocal call_count
                call_count += 1
                if call_count < 2:
                    response = Mock()
                    response.status_code = 429
                    response.headers = {"Retry-After": str(retry_after)}
                    error = requests.exceptions.HTTPError("Rate limited")
                    error.response = response
                    raise error
                return "success"

            with patch("time.sleep") as mock_sleep:
                assert rate_limited() == "success"
                (slept,) = mock_sleep.call_args.args
                observed.append(slept)

        # Never earlier than the server permitted, never unboundedly later.
        assert all(
            retry_after <= s <= retry_after + RATE_LIMIT_JITTER_SECONDS
            for s in observed
        )
        # Actually spread — a fixed sleep would collapse to a single value.
        assert len(set(observed)) > 1

    def test_exponential_backoff(self):
        """Nominal backoff progression with jitter pinned to the upper bound."""
        call_count = 0

        @retry_on_failure(max_attempts=3, backoff_seconds=1.0, exponential_backoff=True)
        def failing_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise requests.exceptions.ConnectionError("Network error")
            return "success"

        # Pin jitter to its upper bound so we can assert the nominal
        # exponential progression (1.0, 2.0). Jitter is exercised
        # separately in test_jitter_is_applied below.
        with (
            patch("time.sleep") as mock_sleep,
            patch("stravapipe.retry.random.uniform", side_effect=lambda _, b: b),
        ):
            result = failing_func()
            assert result == "success"

            expected_calls = [1.0, 2.0]
            actual_calls = [call[0][0] for call in mock_sleep.call_args_list]
            assert actual_calls == expected_calls

    def test_linear_backoff(self):
        """Linear (non-exponential) backoff with jitter pinned to the upper bound."""
        call_count = 0

        @retry_on_failure(
            max_attempts=3, backoff_seconds=0.5, exponential_backoff=False
        )
        def failing_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise requests.exceptions.ConnectionError("Network error")
            return "success"

        with (
            patch("time.sleep") as mock_sleep,
            patch("stravapipe.retry.random.uniform", side_effect=lambda _, b: b),
        ):
            result = failing_func()
            assert result == "success"

            expected_calls = [0.5, 0.5]
            actual_calls = [call[0][0] for call in mock_sleep.call_args_list]
            assert actual_calls == expected_calls

    def test_jitter_is_applied(self):
        """Full jitter samples from [0, base * 2^attempt) per AWS guidance.

        Without jitter, concurrent failing requests retry in lockstep,
        amplifying load on a recovering endpoint. The test pins
        ``random.uniform`` to a fixed fraction (0.5) so the assertion
        is deterministic, but checks the bound argument matches the
        nominal exponential value — verifying jitter receives the
        right window.
        """
        call_count = 0

        @retry_on_failure(max_attempts=3, backoff_seconds=1.0, exponential_backoff=True)
        def failing_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise requests.exceptions.ConnectionError("Network error")
            return "success"

        with (
            patch("time.sleep") as mock_sleep,
            patch(
                "stravapipe.retry.random.uniform", side_effect=lambda a, b: (a + b) / 2
            ) as mock_uniform,
        ):
            failing_func()

            # Both calls should request jitter over [0, nominal]:
            # attempt 0 → nominal 1.0; attempt 1 → nominal 2.0.
            assert mock_uniform.call_args_list == [
                ((0, 1.0),),
                ((0, 2.0),),
            ]
            # Sleeps are the midpoint of each window.
            actual_sleeps = [call[0][0] for call in mock_sleep.call_args_list]
            assert actual_sleeps == [0.5, 1.0]

    @pytest.mark.parametrize("status_code", [500, 502, 503, 504])
    def test_all_5xx_errors_are_retried(self, status_code):
        """Test that all 5xx status codes trigger retries."""
        call_count = 0

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def server_error_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                response = Mock()
                response.status_code = status_code
                error = requests.exceptions.HTTPError(f"{status_code} error")
                error.response = response
                raise error
            return "success"

        result = server_error_func()
        assert result == "success"
        assert call_count == 2

    @pytest.mark.parametrize("status_code", [400, 401, 403, 404, 422])
    def test_4xx_errors_not_retried(self, status_code):
        """Test that 4xx errors (except 429) are not retried."""

        @retry_on_failure(max_attempts=3)
        def client_error_func():
            response = Mock()
            response.status_code = status_code
            error = requests.exceptions.HTTPError(f"{status_code} error")
            error.response = response
            raise error

        with pytest.raises(requests.exceptions.HTTPError):
            client_error_func()

    def test_http_error_without_response(self):
        """Test HTTP error without response object."""
        call_count = 0

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def no_response_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                error = requests.exceptions.HTTPError("Error without response")
                # No response attribute
                raise error
            return "success"

        result = no_response_func()
        assert result == "success"
        assert call_count == 2

    def test_all_attempts_fail(self):
        """Test when all retry attempts are exhausted."""

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def always_failing():
            raise requests.exceptions.ConnectionError("Always fails")

        with pytest.raises(requests.exceptions.ConnectionError):
            always_failing()

    def test_preserves_function_metadata(self):
        """Test that decorator preserves function metadata."""

        @retry_on_failure()
        def documented_func():
            """This function has documentation."""
            return "result"

        assert documented_func.__name__ == "documented_func"
        assert documented_func.__doc__ is not None
        assert "This function has documentation." in documented_func.__doc__

    @patch("stravapipe.retry.logger")
    def test_logging_retry_attempts(self, mock_logger):
        """Test that retry attempts are logged."""
        call_count = 0

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def failing_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise requests.exceptions.ConnectionError("Network error")
            return "success"

        with patch("time.sleep"):
            result = failing_func()
            assert result == "success"

        # Should log warning about retry
        mock_logger.warning.assert_called_once()
        # Check that warning was called with the format string and correct arguments
        args, _ = mock_logger.warning.call_args
        format_string = args[0]
        format_args = args[1:]
        assert "Request failed (attempt %d/%d)" in format_string
        assert format_args[0] == 1  # attempt number
        assert format_args[1] == 2  # max attempts

    @patch("stravapipe.retry.logger")
    def test_logging_final_failure(self, mock_logger):
        """Test that final failure is logged."""

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def always_failing():
            raise requests.exceptions.ConnectionError("Always fails")

        with patch("time.sleep"), pytest.raises(requests.exceptions.ConnectionError):
            always_failing()

        # Should log error about all attempts failing
        mock_logger.error.assert_called_once()
        args, kwargs = mock_logger.error.call_args
        assert args == ("All %d retry attempts failed", 2)
        assert "extra" in kwargs


def _attrs(span_or_event):
    """Return .attributes, narrowed from OTel's ``Attributes | None``."""
    attributes = span_or_event.attributes
    assert attributes is not None
    return attributes


class TestRetrySpanEvents:
    """strava.retry events + exhaustion attributes (parity with the Go side)."""

    @staticmethod
    def _exporter() -> tuple[TracerProvider, InMemorySpanExporter]:
        exporter = InMemorySpanExporter()
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        return provider, exporter

    def test_network_error_emits_retry_events_and_exhausted(self):
        """Network failures: strava.retry events + exhaustion attrs, no body.

        The ``backoff`` attribute should record the *actual* (post-jitter)
        sleep so Cloud Trace surfaces the real delay distribution. We
        pin ``random.uniform`` to a fixed fraction so the asserted values
        are deterministic; without jitter the test would assert the
        nominal exponential curve.
        """
        provider, exporter = self._exporter()
        tracer = provider.get_tracer("test")

        @retry_on_failure(max_attempts=3, backoff_seconds=0.01)
        def always_fails():
            raise requests.exceptions.ConnectionError("boom")

        with (
            patch("time.sleep"),
            patch("stravapipe.retry.random.uniform", side_effect=lambda _, b: b * 0.25),
            tracer.start_as_current_span("parent"),
            pytest.raises(requests.exceptions.ConnectionError),
        ):
            always_fails()

        span = exporter.get_finished_spans()[0]
        events = [e for e in span.events if e.name == "strava.retry"]
        assert len(events) == 2  # max_attempts - 1
        # Attempt 1 nominal = 0.01 * 2^0 = 0.01 → 0.25 * 0.01 = 0.0025
        # Attempt 2 nominal = 0.01 * 2^1 = 0.02 → 0.25 * 0.02 = 0.005
        expected_backoffs = ["0.0025s", "0.005s"]
        for i, (e, expected_backoff) in enumerate(
            zip(events, expected_backoffs, strict=True), start=1
        ):
            assert _attrs(e)["attempt"] == i
            assert _attrs(e)["error"] == "ConnectionError"
            assert _attrs(e)["backoff"] == expected_backoff
            # Network errors have no HTTP status and never a response body.
            assert "status_code" not in _attrs(e)
        assert _attrs(span)["strava.attempts"] == 3
        assert _attrs(span)["strava.exhausted"] is True

    def test_server_error_event_carries_status_code(self):
        """5xx: bounded status_code on the event, never a free-form error."""
        provider, exporter = self._exporter()
        tracer = provider.get_tracer("test")

        resp = Mock()
        resp.status_code = 500
        http_err = requests.exceptions.HTTPError("500")
        http_err.response = resp

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def always_500():
            raise http_err

        with (
            patch("time.sleep"),
            tracer.start_as_current_span("parent"),
            pytest.raises(requests.exceptions.HTTPError),
        ):
            always_500()

        span = exporter.get_finished_spans()[0]
        events = [e for e in span.events if e.name == "strava.retry"]
        assert len(events) == 1  # max_attempts - 1
        assert _attrs(events[0])["status_code"] == 500
        assert "error" not in _attrs(events[0])
        assert _attrs(span)["strava.exhausted"] is True


class TestParseRetryAfter:
    """Test ``_parse_retry_after`` (RFC 7231: delta-seconds OR HTTP-date)."""

    def test_delta_seconds(self):
        assert _parse_retry_after("30") == 30

    def test_delta_seconds_with_whitespace(self):
        assert _parse_retry_after("  30  ") == 30

    def test_missing_header_uses_default(self):
        assert _parse_retry_after(None) == 60
        assert _parse_retry_after(None, default=5) == 5

    def test_negative_delta_clamped_to_zero(self):
        assert _parse_retry_after("-5") == 0

    def test_http_date_in_the_future(self):
        future = datetime.now(UTC) + timedelta(seconds=120)
        header = format_datetime(future, usegmt=True)
        # Allow a small scheduling delta; should be ~120s, never the default.
        assert 110 <= _parse_retry_after(header) <= 120

    def test_http_date_in_the_past_clamped_to_zero(self):
        past = datetime.now(UTC) - timedelta(seconds=120)
        assert _parse_retry_after(format_datetime(past, usegmt=True)) == 0

    def test_http_date_rounds_fractional_delta_up(self):
        """A fractional date delta must round *up* (ceil), never truncate —
        truncating a 1.5s wait to 1s retries before the window reopens and
        risks an immediate repeat 429."""
        target = datetime(2026, 1, 1, 0, 0, 10, tzinfo=UTC)
        fake_now = datetime(2026, 1, 1, 0, 0, 8, 500_000, tzinfo=UTC)  # 1.5s before
        header = format_datetime(target, usegmt=True)
        with patch("stravapipe.retry.datetime") as mock_dt:
            mock_dt.now.return_value = fake_now
            assert _parse_retry_after(header) == 2  # ceil(1.5), not int(1.5)==1

    def test_garbage_value_falls_back_to_default(self):
        # The bug: a non-numeric, non-date value must not raise ValueError.
        assert _parse_retry_after("not-a-date-or-int") == 60

    def test_date_form_header_does_not_crash_the_decorator(self):
        """Regression: a 429 carrying an HTTP-date ``Retry-After`` used to
        raise an uncaught ``ValueError`` from ``int()`` instead of being
        handled as a rate-limit. It must now retry and surface
        ``StravaRateLimitError`` on exhaustion."""
        http_date = format_datetime(
            datetime.now(UTC) + timedelta(seconds=1), usegmt=True
        )

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def always_rate_limited():
            response = Mock()
            response.status_code = 429
            response.headers = {"Retry-After": http_date}
            error = requests.exceptions.HTTPError("Rate limited")
            error.response = response
            raise error

        with patch("time.sleep"), pytest.raises(StravaRateLimitError):
            always_rate_limited()
