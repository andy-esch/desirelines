"""Unit tests for parse_pubsub_cloudevent.

Drives parse_pubsub_cloudevent through a minimal FastAPI app to verify that
broker-side identifiers (pubsub_message_id, delivery_attempt) make it onto
CloudEventContext, including the first-delivery / no-DLQ case where
deliveryAttempt is absent on the envelope.
"""

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
import pytest

from stravapipe.cloudrun.pubsub import parse_pubsub_cloudevent

from .conftest import make_cloudevent_headers, make_pubsub_body, make_webhook_payload


@pytest.fixture
def app():
    test_app = FastAPI()

    @test_app.post("/")
    async def handle(request: Request) -> dict:
        ctx, _data, _attrs = await parse_pubsub_cloudevent(request)
        return {
            "pubsub_message_id": ctx.pubsub_message_id,
            "delivery_attempt": ctx.delivery_attempt,
            "event_type": ctx.event_type,
        }

    return TestClient(test_app)


class TestPubSubMessageIDOnContext:
    def test_message_id_surfaced_from_envelope(self, app):
        response = app.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload()),
        )
        assert response.status_code == 200
        # The conftest fixture hard-codes "test-message-123"
        assert response.json()["pubsub_message_id"] == "test-message-123"


class TestDeliveryAttemptOnContext:
    def test_delivery_attempt_surfaced_when_present(self, app):
        response = app.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload(), delivery_attempt=3),
        )
        assert response.status_code == 200
        assert response.json()["delivery_attempt"] == 3

    def test_delivery_attempt_is_none_when_absent(self, app):
        response = app.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload()),
        )
        assert response.status_code == 200
        assert response.json()["delivery_attempt"] is None


class TestContentTypeGate:
    """The accepted content types must match what the parser implements.

    Only binary-mode CloudEvents are parsed (metadata in ce-* headers). Structured
    mode — everything inside a JSON body under ``application/cloudevents+json`` —
    used to be accepted here, cleared the gate, and then failed further down with
    a 400 about missing ce-* headers. That reads as a malformed request rather
    than an unsupported format. Audit 2026-08-06-stravapipe L1.
    """

    def test_binary_mode_is_accepted(self, app):
        response = app.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload()),
        )
        assert response.status_code == 200

    def test_structured_mode_is_rejected_as_unsupported_not_malformed(self, app):
        headers = make_cloudevent_headers()
        headers["content-type"] = "application/cloudevents+json"

        response = app.post(
            "/", headers=headers, json=make_pubsub_body(make_webhook_payload())
        )

        # 415, not 400: the format is unsupported, not the payload malformed.
        assert response.status_code == 415
        assert "application/cloudevents+json" in response.json()["detail"]

    def test_charset_parameter_does_not_defeat_the_gate(self, app):
        headers = make_cloudevent_headers()
        headers["content-type"] = "application/json; charset=utf-8"

        response = app.post(
            "/", headers=headers, json=make_pubsub_body(make_webhook_payload())
        )
        assert response.status_code == 200
