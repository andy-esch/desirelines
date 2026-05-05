"""Unit tests for the readiness probe helper.

Focus: the retry-with-backoff behavior added for cold-start tail latency.
HTTP integration is covered in cloudrun/test_*_app.py per service.

Async functions are driven via asyncio.run() rather than pytest-asyncio so
this suite stays free of an extra test dependency.
"""

import asyncio

from stravapipe.shared import readiness
from stravapipe.shared.readiness import _run_with_timeout, run_checks


class TestRunWithTimeoutRetry:
    """Single-probe retry semantics."""

    def test_success_first_try_no_retry(self):
        """A probe that succeeds on the first attempt is not retried."""
        calls = 0

        async def probe() -> None:
            nonlocal calls
            calls += 1

        result = asyncio.run(
            _run_with_timeout("ok", probe, timeout=1.0, retry_backoff=0)
        )

        assert result is None
        assert calls == 1

    def test_transient_failure_recovers_on_retry(self):
        """First-attempt failure followed by success returns None (healthy)."""
        calls = 0

        async def probe() -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("transient")

        result = asyncio.run(
            _run_with_timeout("flaky", probe, timeout=1.0, retry_backoff=0)
        )

        assert result is None
        assert calls == 2

    def test_persistent_failure_returns_error_after_one_retry(self):
        """Two consecutive failures return the retry's error string. Exactly one retry."""
        calls = 0

        async def probe() -> None:
            nonlocal calls
            calls += 1
            raise RuntimeError("persistent")

        result = asyncio.run(
            _run_with_timeout("broken", probe, timeout=1.0, retry_backoff=0)
        )

        assert result is not None
        assert "broken" in result
        assert "persistent" in result
        assert calls == 2  # one initial + exactly one retry

    def test_timeout_classification_survives_retry(self):
        """A persistent timeout returns 'name: timeout', not the underlying exc."""

        async def probe() -> None:
            await asyncio.sleep(10)  # longer than timeout; wait_for cancels

        result = asyncio.run(
            _run_with_timeout("slow", probe, timeout=0.01, retry_backoff=0)
        )

        assert result == "slow: timeout"

    def test_retry_backoff_actually_sleeps(self, monkeypatch):
        """retry_backoff > 0 sleeps between attempts (verified via asyncio.sleep call)."""
        sleeps: list[float] = []

        original_sleep = asyncio.sleep

        async def fake_sleep(delay: float) -> None:
            sleeps.append(delay)
            await original_sleep(0)  # yield once but don't actually wait

        monkeypatch.setattr(readiness.asyncio, "sleep", fake_sleep)

        async def probe() -> None:
            raise RuntimeError("fail")

        asyncio.run(_run_with_timeout("x", probe, timeout=1.0, retry_backoff=0.5))

        assert sleeps == [0.5]


class TestRunChecksRetry:
    """Concurrent probe orchestration: retry is per-probe, not whole-handler."""

    def test_one_probe_retries_independently_of_another(self):
        """A flaky probe retries; a successful probe doesn't get re-run."""
        flaky_calls = 0
        ok_calls = 0

        async def flaky() -> None:
            nonlocal flaky_calls
            flaky_calls += 1
            if flaky_calls == 1:
                raise RuntimeError("transient")

        async def ok() -> None:
            nonlocal ok_calls
            ok_calls += 1

        result = asyncio.run(
            run_checks({"flaky": flaky, "ok": ok}, timeout=1.0, retry_backoff=0)
        )

        assert result == {"flaky": None, "ok": None}
        assert flaky_calls == 2  # retried
        assert ok_calls == 1  # not re-run

    def test_persistent_failure_in_one_probe_does_not_block_other(self):
        """A failing probe returns its error; a passing probe still returns None."""

        async def bad() -> None:
            raise RuntimeError("down")

        async def good() -> None:
            pass

        result = asyncio.run(
            run_checks({"bad": bad, "good": good}, timeout=1.0, retry_backoff=0)
        )

        assert result["good"] is None
        assert result["bad"] is not None
        assert "down" in result["bad"]
