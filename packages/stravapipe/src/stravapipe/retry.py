"""Retry logic for external API calls."""

from collections.abc import Callable
from functools import wraps
import logging
import time
from typing import Any, TypeVar, cast

import requests

from stravapipe.exceptions import StravaRateLimitError

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])

# HTTP status code constants used by retry decisions.
HTTP_TOO_MANY_REQUESTS = 429
HTTP_INTERNAL_SERVER_ERROR = 500


def retry_on_failure(
    max_attempts: int = 3,
    backoff_seconds: float = 1.0,
    exponential_backoff: bool = True,
) -> Callable[[F], F]:
    """Retry decorator for API calls with exponential backoff.

    Retries on: 429 (rate limit), 5xx (server errors), connection errors,
    and timeouts. All other HTTP errors are raised immediately.

    Args:
        max_attempts: Maximum number of retry attempts
        backoff_seconds: Initial delay between retries
        exponential_backoff: Whether to use exponential backoff
    """

    def decorator(func: F) -> F:
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None

            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)

                except requests.exceptions.HTTPError as e:
                    if hasattr(e, "response") and e.response is not None:
                        status_code = e.response.status_code

                        # Handle rate limiting specially
                        if status_code == HTTP_TOO_MANY_REQUESTS:
                            retry_after = int(e.response.headers.get("Retry-After", 60))
                            if attempt == max_attempts - 1:
                                raise StravaRateLimitError(
                                    f"Rate limit exceeded after {max_attempts} "
                                    "attempts",
                                    retry_after=retry_after,
                                ) from e
                            logger.warning(
                                "Rate limited, waiting %s seconds (attempt %d/%d)",
                                retry_after,
                                attempt + 1,
                                max_attempts,
                                extra={
                                    "operation": "retry_rate_limit",
                                    "attempt": attempt + 1,
                                    "max_attempts": max_attempts,
                                    "retry_after_seconds": retry_after,
                                    "status_code": status_code,
                                },
                            )
                            time.sleep(retry_after)
                            continue

                        # Don't retry on client errors (except rate limiting)
                        if status_code < HTTP_INTERNAL_SERVER_ERROR:
                            raise

                        # Retry on server errors (5xx)
                        last_exception = e
                    else:
                        # Network error without response
                        last_exception = e

                except (
                    requests.exceptions.ConnectionError,
                    requests.exceptions.Timeout,
                ) as e:
                    last_exception = e

                # Don't sleep on the last attempt
                if attempt < max_attempts - 1:
                    delay = backoff_seconds
                    if exponential_backoff:
                        delay *= 2**attempt

                    logger.warning(
                        "Request failed (attempt %d/%d), retrying in %.1f seconds: %s",
                        attempt + 1,
                        max_attempts,
                        delay,
                        str(last_exception),
                        extra={
                            "operation": "retry_attempt",
                            "attempt": attempt + 1,
                            "max_attempts": max_attempts,
                            "delay_seconds": delay,
                            "exception_type": type(last_exception).__name__,
                        },
                    )
                    time.sleep(delay)

            # All attempts failed
            logger.error(
                "All %d retry attempts failed",
                max_attempts,
                extra={
                    "operation": "retry_exhausted",
                    "max_attempts": max_attempts,
                    "final_exception": type(last_exception).__name__
                    if last_exception
                    else "unknown",
                },
            )
            if last_exception:
                raise last_exception
            # This should never happen - loop only exits without exception if
            # max_attempts == 0, but guards against implicit None return
            raise RuntimeError(
                f"Retry loop exited unexpectedly after {max_attempts} attempts"
            )

        return cast(F, wrapper)

    return decorator
