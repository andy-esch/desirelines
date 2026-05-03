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
