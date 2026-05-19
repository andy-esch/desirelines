"""Tests for retry logic."""

from unittest.mock import Mock, patch

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
import pytest
import requests

from stravapipe.exceptions import StravaRateLimitError
from stravapipe.retry import retry_on_failure


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
            mock_sleep.assert_called_once_with(1)

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
            mock_sleep.assert_called_once_with(60)  # Default fallback

    def test_exponential_backoff(self):
        """Test exponential backoff timing."""
        call_count = 0

        @retry_on_failure(max_attempts=3, backoff_seconds=1.0, exponential_backoff=True)
        def failing_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise requests.exceptions.ConnectionError("Network error")
            return "success"

        with patch("time.sleep") as mock_sleep:
            result = failing_func()
            assert result == "success"

            # Should have slept twice: 1.0 seconds, then 2.0 seconds
            expected_calls = [1.0, 2.0]
            actual_calls = [call[0][0] for call in mock_sleep.call_args_list]
            assert actual_calls == expected_calls

    def test_linear_backoff(self):
        """Test linear backoff timing."""
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

        with patch("time.sleep") as mock_sleep:
            result = failing_func()
            assert result == "success"

            # Should have slept twice: 0.5 seconds each time
            expected_calls = [0.5, 0.5]
            actual_calls = [call[0][0] for call in mock_sleep.call_args_list]
            assert actual_calls == expected_calls

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
        """Network failures: strava.retry events + exhaustion attrs, no body."""
        provider, exporter = self._exporter()
        tracer = provider.get_tracer("test")

        @retry_on_failure(max_attempts=3, backoff_seconds=0.01)
        def always_fails():
            raise requests.exceptions.ConnectionError("boom")

        with (
            patch("time.sleep"),
            tracer.start_as_current_span("parent"),
            pytest.raises(requests.exceptions.ConnectionError),
        ):
            always_fails()

        span = exporter.get_finished_spans()[0]
        events = [e for e in span.events if e.name == "strava.retry"]
        assert len(events) == 2  # max_attempts - 1
        for i, e in enumerate(events, start=1):
            assert _attrs(e)["attempt"] == i
            assert _attrs(e)["error"] == "ConnectionError"
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
