"""Retry logic for external API calls."""

from collections.abc import Callable
from functools import wraps
import logging
import random
import time
from typing import Any, TypeVar, cast

from opentelemetry.trace import get_current_span
import requests

from stravapipe.exceptions import StravaRateLimitError

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])

# HTTP status code constants used by retry decisions.
HTTP_TOO_MANY_REQUESTS = 429
HTTP_INTERNAL_SERVER_ERROR = 500


def _add_retry_event(
    attempt: int,
    backoff_seconds: float,
    *,
    status_code: int | None = None,
    error: str | None = None,
) -> None:
    """Emit a ``strava.retry`` event on the current span (no-op if none).

    Mirrors the dispatcher's Go ``strava.retry`` events so retries are
    visible cross-language in Cloud Trace. ``status_code`` is preferred;
    ``error`` is a bounded exception type name, never a response body.

    ``backoff_seconds`` is the *actual* (post-jitter) sleep duration, not
    the nominal exponential value — so Cloud Trace surfaces the real
    delay distribution rather than the deterministic curve.
    """
    attrs: dict[str, Any] = {"attempt": attempt, "backoff": f"{backoff_seconds:g}s"}
    if status_code is not None:
        attrs["status_code"] = status_code
    elif error is not None:
        attrs["error"] = error
    get_current_span().add_event("strava.retry", attrs)


def _mark_retries_exhausted(max_attempts: int) -> None:
    """Stamp the current span when every retry attempt was used up."""
    span = get_current_span()
    span.set_attribute("strava.attempts", max_attempts)
    span.set_attribute("strava.exhausted", True)


def retry_on_failure(
    max_attempts: int = 3,
    backoff_seconds: float = 1.0,
    exponential_backoff: bool = True,
) -> Callable[[F], F]:
    """Retry decorator for API calls with exponential backoff and full jitter.

    Retries on: 429 (rate limit), 5xx (server errors), connection errors,
    and timeouts. All other HTTP errors are raised immediately.

    Backoff applies AWS "full jitter" — the actual sleep on retry ``n`` is
    sampled uniformly from ``[0, base * 2^n)`` (or ``[0, base)`` when
    ``exponential_backoff=False``). Without jitter, concurrent failing
    requests retry in lockstep and amplify load on a recovering endpoint
    (https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/).
    Mirrors the Go-side ``jitterBackoff`` in
    ``packages/dispatcher/adapters/strava/client.go``.

    Args:
        max_attempts: Maximum number of retry attempts.
        backoff_seconds: Upper bound of the jitter window on the first
            retry (and the base of the exponential progression when
            ``exponential_backoff=True``). NOT the deterministic sleep.
        exponential_backoff: If True, the jitter window doubles each
            attempt (`base`, `2*base`, `4*base`, …). If False, every
            attempt samples from `[0, base)`.
    """

    def decorator(func: F) -> F:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception: Exception | None = None

            for attempt in range(max_attempts):
                retry_status: int | None = None
                try:
                    return func(*args, **kwargs)

                except requests.exceptions.HTTPError as e:
                    if hasattr(e, "response") and e.response is not None:
                        status_code = e.response.status_code

                        # Handle rate limiting specially
                        if status_code == HTTP_TOO_MANY_REQUESTS:
                            retry_after = int(e.response.headers.get("Retry-After", 60))
                            if attempt == max_attempts - 1:
                                _mark_retries_exhausted(max_attempts)
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
                            _add_retry_event(
                                attempt + 1,
                                float(retry_after),
                                status_code=status_code,
                            )
                            time.sleep(retry_after)
                            continue

                        # Don't retry on client errors (except rate limiting)
                        if status_code < HTTP_INTERNAL_SERVER_ERROR:
                            raise

                        # Retry on server errors (5xx)
                        last_exception = e
                        retry_status = status_code
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
                    nominal = backoff_seconds
                    if exponential_backoff:
                        nominal *= 2**attempt
                    # Full jitter (AWS "Exponential Backoff And Jitter"):
                    # `sleep = random_between(0, base * 2^attempt)`. Prevents
                    # concurrent failing requests (backfill bursts, post-
                    # outage webhook catch-up) from re-firing in lockstep
                    # and amplifying load on a recovering Strava endpoint.
                    # Mirrors the Go-side jitter in `dispatcher/adapters/strava/client.go`.
                    delay = random.uniform(0, nominal)

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
                    _add_retry_event(
                        attempt + 1,
                        delay,
                        status_code=retry_status,
                        error=(
                            None
                            if retry_status is not None
                            else type(last_exception).__name__
                        ),
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
            _mark_retries_exhausted(max_attempts)
            if last_exception:
                raise last_exception
            # This should never happen - loop only exits without exception if
            # max_attempts == 0, but guards against implicit None return
            raise RuntimeError(
                f"Retry loop exited unexpectedly after {max_attempts} attempts"
            )

        return cast(F, wrapper)

    return decorator
