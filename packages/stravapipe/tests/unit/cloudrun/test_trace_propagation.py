"""Cross-service trace-propagation tests for the CloudEvent handlers.

The dispatcher publishes a `traceparent` PubSub message attribute; every
worker must extract it and parent its processing span under it so a
single trace_id spans the pipeline (see EXAMPLE_TRACEPARENT in conftest).

There are two distinct extract paths in the codebase, and each gets its
own test here:

  1. handle_webhook_cloudevent — the shared helper used by the
     webhook-driven apps (postgres_writer_app today). Testing it once
     covers them; testing each app separately would re-run this code.
  2. deletion_service_app — has its own parse+extract path (it does NOT
     use handle_webhook_cloudevent), so it can regress independently and
     needs its own test.

This is the Python counterpart of the Go-side guards: the publisher
contract test asserts the inject side, and the lintpub analyzer flags a
publish without a paired inject. Here we assert the extract side — a
handler that skipped extract_context_from_attributes would start a fresh
root span, and the trace-id assertion below would catch it.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
import pytest

from stravapipe.cloudrun.webhook_handler import handle_webhook_cloudevent
from stravapipe.shared.constants import ResponseStatus
from stravapipe.shared.responses import WebhookResponse

from .conftest import (
    EXAMPLE_TRACE_ID_HEX,
    EXAMPLE_TRACEPARENT,
    make_cloudevent_headers,
    make_in_memory_tracer,
    make_pubsub_body,
    make_webhook_payload,
)


def _processing_span(exporter, name):
    """Return the single finished span named `name`, asserting there's exactly one."""
    spans = exporter.get_finished_spans()
    matches = [s for s in spans if s.name == name]
    assert len(matches) == 1, (
        f"expected exactly one {name!r} span, got {[s.name for s in spans]}"
    )
    return matches[0]


def test_handle_webhook_cloudevent_continues_inbound_trace():
    """handle_webhook_cloudevent must parent its `webhook.process` span
    under the inbound `traceparent` — the shared webhook path."""
    tracer, exporter = make_in_memory_tracer()

    test_app = FastAPI()

    @test_app.post("/")
    async def handle(request: Request):
        return await handle_webhook_cloudevent(
            request,
            MagicMock(),  # logger
            on_create=AsyncMock(
                return_value=WebhookResponse(status=ResponseStatus.CREATED)
            ),
            tracer=tracer,
            span_name="webhook.process",
        )

    response = TestClient(test_app).post(
        "/",
        headers=make_cloudevent_headers(),
        json=make_pubsub_body(
            make_webhook_payload(aspect_type="create"),
            attributes={"traceparent": EXAMPLE_TRACEPARENT},
        ),
    )
    assert response.status_code == 200

    span = _processing_span(exporter, "webhook.process")
    assert f"{span.context.trace_id:032x}" == EXAMPLE_TRACE_ID_HEX, (
        "webhook.process span did not adopt the inbound traceparent trace-id "
        "— extract_context_from_attributes may have been skipped"
    )


def _deauth_payload(owner_id: int = 98765) -> dict:
    """A deauth event payload matching what the dispatcher publishes."""
    return {
        "aspect_type": "update",
        "event_time": 1704067200,
        "object_id": owner_id,
        "object_type": "athlete",
        "owner_id": owner_id,
        "subscription_id": 123456,
        "updates": {"authorized": "false"},
    }


@pytest.fixture
def deletion_client():
    """Boot deletion_service_app with all external deps mocked, plus an
    inspectable in-memory tracer.

    The deletion service's stores (Postgres / BigQuery / Firestore) are
    patched at their import sites, so the lifespan populates
    `app.state.{session_factory, bq_deletion_service, token_store, ...}`
    with harmless MagicMocks on its own — no manual assignment needed.
    This test only cares that the `deletion.process` span is parented
    correctly, which happens before any store work.

    The one real override is the tracer: the lifespan installs a no-op
    one, and we swap in the in-memory tracer via `patch.object` so it is
    restored on teardown rather than leaking onto the module-level `app`
    singleton (which other tests in this directory re-boot and share).
    """
    tracer, exporter = make_in_memory_tracer()
    with (
        patch("stravapipe.cloudrun.deletion_service_app.load_deletion_service_config"),
        patch(
            "stravapipe.cloudrun.deletion_service_app.create_session_factory"
        ) as mock_factory,
        patch("stravapipe.cloudrun.deletion_service_app.BigQueryClientWrapper"),
        patch("stravapipe.cloudrun.deletion_service_app.FirestoreClient"),
        patch("stravapipe.cloudrun.deletion_service_app.BQUserDeletionService"),
        patch("stravapipe.cloudrun.deletion_service_app.FirestoreTokenStore"),
    ):
        mock_factory.return_value = (MagicMock(), MagicMock())

        from stravapipe.cloudrun.deletion_service_app import app

        # TestClient enters first (its lifespan installs the no-op
        # tracer), then patch.object overrides it — and restores it on
        # exit, before the lifespan shuts down.
        with (
            TestClient(app) as client,
            patch.object(app.state, "tracer", tracer),
        ):
            yield client, exporter


def test_deletion_service_continues_inbound_trace(deletion_client):
    """deletion_service_app's own extract path must parent its
    `deletion.process` span under the inbound `traceparent`.

    Status is intentionally not asserted: with the stores mocked, the
    downstream deletion result is uninteresting. `record_span` wraps the
    work, so the span is created with its parent regardless of how the
    deletion itself resolves — and the span is what's under test.
    """
    client, exporter = deletion_client

    client.post(
        "/",
        headers=make_cloudevent_headers(),
        json=make_pubsub_body(
            _deauth_payload(),
            attributes={"traceparent": EXAMPLE_TRACEPARENT},
        ),
    )

    span = _processing_span(exporter, "deletion.process")
    assert f"{span.context.trace_id:032x}" == EXAMPLE_TRACE_ID_HEX, (
        "deletion.process span did not adopt the inbound traceparent trace-id "
        "— deletion_service_app's extract path may have been skipped"
    )
