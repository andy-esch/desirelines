"""Tests for retry logic."""

from unittest.mock import Mock, patch

import pytest
import requests

from stravabqsync.exceptions import StravaRateLimitError
from stravabqsync.retry import retry_on_failure


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

    def test_custom_retry_status_codes(self):
        """Test custom retry status codes."""

        @retry_on_failure(max_attempts=2, retry_on_status=(502, 503))
        def custom_retry_func():
            response = Mock()
            response.status_code = 504  # Not in retry_on_status
            error = requests.exceptions.HTTPError("Gateway timeout")
            error.response = response
            raise error

        # Should not retry 504 since it's not in custom retry_on_status
        with pytest.raises(requests.exceptions.HTTPError):
            custom_retry_func()

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
        assert "This function has documentation." in documented_func.__doc__

    @patch("stravabqsync.retry.logger")
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
        args, kwargs = mock_logger.warning.call_args
        format_string = args[0]
        format_args = args[1:]
        assert "Request failed (attempt %d/%d)" in format_string
        assert format_args[0] == 1  # attempt number
        assert format_args[1] == 2  # max attempts

    @patch("stravabqsync.retry.logger")
    def test_logging_final_failure(self, mock_logger):
        """Test that final failure is logged."""

        @retry_on_failure(max_attempts=2, backoff_seconds=0.01)
        def always_failing():
            raise requests.exceptions.ConnectionError("Always fails")

        with patch("time.sleep"), pytest.raises(requests.exceptions.ConnectionError):
            always_failing()

        # Should log error about all attempts failing
        mock_logger.error.assert_called_once_with("All %d retry attempts failed", 2)
