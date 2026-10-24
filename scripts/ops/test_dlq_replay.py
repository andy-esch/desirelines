"""Capture the real replay request/ack boundary without cloud access."""

from __future__ import annotations

import base64
import copy
from email.message import Message
import io
import json
from pathlib import Path
from typing import Any
import urllib.error
import urllib.request

from ops import dlq_replay as dlq
import pytest

TOPIC = "projects/desirelines-dev/topics/desirelines-activity-rows-dev"
SUB = "projects/desirelines-dev/subscriptions/desirelines-activity-rows-dlq-monitoring-dev"
PROTOBUF_CDC = b"\x08\x01*\x04a\x00b\n\xb2>\x06UPSERT\xba>\x0210"


def received(data: bytes, number: int = 1, **message: Any) -> dict[str, Any]:
    return {
        "ackId": f"ack-{number}",
        "message": {
            "data": base64.b64encode(data).decode(),
            "messageId": f"message-{number}",
            "publishTime": "2026-10-01T00:00:00Z",
            **message,
        },
    }


class Transport(dlq.PubSub):
    def __init__(
        self,
        *batches: list[dict[str, Any]],
        fail: str = "",
        fail_publish: int = 0,
        publish_response: dict[str, Any] | None = None,
        encoding: str = "BINARY",
    ) -> None:
        self.batches = list(batches)
        self.calls: list[tuple[str, str, dict[str, Any] | None]] = []
        self.fail = fail
        self.fail_publish = fail_publish
        self.publishes = 0
        self.publish_response = publish_response
        self.topic_encoding = encoding

    def request(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        self.calls.append((method, path, copy.deepcopy(body)))
        operation = path.rsplit(":", 1)[-1]
        if operation == self.fail:
            raise dlq.ReplayError("transport failed")
        if operation == "pull":
            return {"receivedMessages": self.batches.pop(0) if self.batches else []}
        if operation == "publish":
            self.publishes += 1
            if self.publishes == self.fail_publish:
                raise dlq.ReplayError("publish outcome unknown")
            return (
                self.publish_response
                if self.publish_response is not None
                else {"messageIds": ["confirmed"]}
            )
        if method == "GET":
            return {"schemaSettings": {"encoding": self.topic_encoding}}
        return {}

    def bodies(self, operation: str) -> list[dict[str, Any] | None]:
        return [body for _, path, body in self.calls if path.endswith(f":{operation}")]


@pytest.mark.parametrize(
    "data",
    [
        b"\0alpha\0\n\n",
        b"\xff\xfe\x80\0",
        b"",
        b'{"aspect_type":"create"}\n',
        PROTOBUF_CDC,
    ],
)
def test_arbitrary_bytes_survive_publish_before_ack(data: bytes) -> None:
    transport = Transport([received(data)])
    assert dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=False) == 1
    body = transport.bodies("publish")[0]
    assert body is not None
    assert base64.b64decode(body["messages"][0]["data"]) == data
    assert [path.rsplit(":", 1)[-1] for _, path, _ in transport.calls] == [
        "pull",
        "publish",
        "acknowledge",
        "pull",
    ]
    assert transport.bodies("acknowledge") == [{"ackIds": ["ack-1"]}]


def test_attributes_and_ordering_key_preserved_without_stale_validation_metadata() -> (
    None
):
    attributes = {
        "correlation_id": "original",
        "traceparent": "trace",
        "custom": "a,b=c\n\té",
        "CloudPubSubDeadLetterSourceSubscription": "original-sub",
        "CloudPubSubDeadLetterSourceDeliveryCount": "5",
        "dispatcher_received_at_unix_ms": "old",
        "googclient_schemaname": "old-schema",
        "googclient_schemaencoding": "BINARY",
        "googclient_schemarevisionid": "old-revision",
        "googclient_deliveryattempt": "5",
    }
    transport = Transport(
        [received(PROTOBUF_CDC, attributes=attributes, orderingKey="athlete-1")]
    )
    dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=False)
    assert transport.bodies("publish") == [
        {
            "messages": [
                {
                    "data": base64.b64encode(PROTOBUF_CDC).decode(),
                    "attributes": {
                        "correlation_id": "original",
                        "traceparent": "trace",
                        "custom": "a,b=c\n\té",
                        "replayed_from_dlq": "true",
                    },
                    "orderingKey": "athlete-1",
                }
            ]
        }
    ]


def test_application_json_is_not_unwrapped_as_a_dead_letter_envelope() -> None:
    data = b'{"message":{"data":"nested application data"},"aspect_type":"create"}'
    transport = Transport([received(data)])
    dlq.replay(transport, TOPIC, SUB, "JSON", dry_run=False)
    body = transport.bodies("publish")[0]
    assert body is not None
    assert base64.b64decode(body["messages"][0]["data"]) == data


@pytest.mark.parametrize(
    "reply",
    [{}, {"messageIds": []}, {"messageIds": [""]}, {"messageIds": ["one", "two"]}],
)
def test_unconfirmed_publish_is_never_acked(reply: dict[str, Any]) -> None:
    transport = Transport([received(PROTOBUF_CDC)], publish_response=reply)
    with pytest.raises(dlq.ReplayError, match="did not confirm"):
        dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=False)
    assert transport.bodies("acknowledge") == []
    assert transport.bodies("modifyAckDeadline") == [
        {"ackIds": ["ack-1"], "ackDeadlineSeconds": 0}
    ]


def test_partial_failure_acks_only_confirmed_publish_and_releases_remaining_messages() -> (
    None
):
    transport = Transport(
        [received(PROTOBUF_CDC, i) for i in (1, 2, 3)], fail_publish=2
    )
    with pytest.raises(dlq.ReplayError, match="outcome unknown"):
        dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=False)
    assert transport.publishes == 2
    assert transport.bodies("acknowledge") == [{"ackIds": ["ack-1"]}]
    assert transport.bodies("modifyAckDeadline") == [
        {"ackIds": ["ack-2", "ack-3"], "ackDeadlineSeconds": 0}
    ]


def test_ack_failure_does_not_pull_more_and_leaves_messages_available_for_redelivery() -> (
    None
):
    transport = Transport([received(PROTOBUF_CDC)], fail="acknowledge")
    with pytest.raises(dlq.ReplayError):
        dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=False)
    assert len(transport.bodies("pull")) == 1
    assert transport.bodies("modifyAckDeadline") == [
        {"ackIds": ["ack-1"], "ackDeadlineSeconds": 0}
    ]


def test_dry_run_never_publishes_or_acks_and_releases_leases() -> None:
    transport = Transport([received(b"", 1), received(PROTOBUF_CDC, 2)])
    assert dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=True) == 2
    assert not transport.bodies("publish")
    assert not transport.bodies("acknowledge")
    assert transport.bodies("modifyAckDeadline") == [
        {"ackIds": ["ack-1", "ack-2"], "ackDeadlineSeconds": 0}
    ]


def test_dry_run_does_not_count_redeliveries_forever() -> None:
    duplicate = received(PROTOBUF_CDC)
    duplicate["ackId"] = "new-ack"
    transport = Transport([received(PROTOBUF_CDC)], [duplicate])
    assert dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=True) == 1
    assert len(transport.bodies("pull")) == 2


def test_execute_acks_duplicate_of_a_confirmed_publish_without_republishing() -> None:
    duplicate = received(PROTOBUF_CDC)
    duplicate["ackId"] = "new-ack"
    transport = Transport([received(PROTOBUF_CDC)], [duplicate])
    assert dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=False) == 1
    assert len(transport.bodies("publish")) == 1
    assert transport.bodies("acknowledge") == [
        {"ackIds": ["ack-1"]},
        {"ackIds": ["new-ack"]},
    ]


def test_release_failure_is_an_error_without_acknowledging_anything() -> None:
    transport = Transport([received(PROTOBUF_CDC)], fail="modifyAckDeadline")
    with pytest.raises(dlq.ReplayError):
        dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=True)
    assert not transport.bodies("publish")
    assert not transport.bodies("acknowledge")


def test_malformed_message_stops_and_releases_all_pulled_leases() -> None:
    malformed = {"ackId": "malformed", "message": []}
    transport = Transport([malformed, received(PROTOBUF_CDC)])
    with pytest.raises(dlq.ReplayError, match="Invalid received message"):
        dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=False)
    assert not transport.bodies("publish")
    assert not transport.bodies("acknowledge")
    assert transport.bodies("modifyAckDeadline") == [
        {"ackIds": ["malformed", "ack-1"], "ackDeadlineSeconds": 0}
    ]


def test_lease_release_is_bounded_to_pull_batch_size() -> None:
    transport = Transport([received(PROTOBUF_CDC, i) for i in range(51)])
    assert dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=True) == 51
    releases = transport.bodies("modifyAckDeadline")
    assert [len(body["ackIds"]) for body in releases if body is not None] == [50, 1]


def test_invalid_base64_is_not_acked() -> None:
    message = received(b"")
    message["message"]["data"] = "invalid*base64"
    transport = Transport([message])
    with pytest.raises(dlq.ReplayError, match="base64"):
        dlq.replay(transport, TOPIC, SUB, "BINARY", dry_run=False)
    assert not transport.bodies("publish")
    assert not transport.bodies("acknowledge")
    assert transport.bodies("modifyAckDeadline")


@pytest.mark.parametrize(
    ("service", "encoding"),
    [
        ("activity-rows", "UNKNOWN"),
        ("postgres-writer", "BINARY"),
        ("deletion-service", "BINARY"),
    ],
)
def test_unsupported_encoding_fails_before_pull(service: str, encoding: str) -> None:
    transport = Transport(encoding=encoding)
    with pytest.raises(dlq.ReplayError, match="encoding"):
        transport.encoding(TOPIC, service)
    assert not transport.bodies("pull")


@pytest.mark.parametrize(
    "args",
    [
        ["unknown", "dev"],
        ["activity-rows", "other"],
        ["activity-rows", "prod", "extra"],
    ],
)
def test_invalid_cli_arguments_never_reach_cloud(
    args: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dlq, "gcloud", lambda *args: pytest.fail("gcloud must not run"))
    with pytest.raises(SystemExit):
        dlq.main(args)


def test_wrong_project_never_pulls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dlq, "gcloud", lambda *args: "desirelines-prod")
    monkeypatch.setattr(
        dlq, "PubSub", lambda: pytest.fail("client must not be created")
    )
    assert dlq.main(["activity-rows", "dev"]) == 1


def test_cli_defaults_to_dry_run_without_confirmation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = Transport([received(PROTOBUF_CDC)])
    monkeypatch.setattr(dlq, "gcloud", lambda *args: "desirelines-dev")
    monkeypatch.setattr(dlq, "PubSub", lambda: transport)
    monkeypatch.setattr(
        dlq, "confirm", lambda *args: pytest.fail("dry run must not confirm")
    )
    assert dlq.main(["activity-rows", "dev"]) == 0
    assert transport.calls[0] == ("GET", TOPIC, None)
    assert transport.bodies("pull")
    assert not transport.bodies("publish")
    assert not transport.bodies("acknowledge")


def test_cancelled_execution_never_creates_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dlq, "gcloud", lambda *args: "desirelines-prod")
    monkeypatch.setattr(Path, "open", lambda *args, **kwargs: io.StringIO("no\n"))
    monkeypatch.setattr(
        dlq, "PubSub", lambda: pytest.fail("cancelled replay must not reach Pub/Sub")
    )
    assert dlq.main(["activity-rows", "prod", "--execute"]) == 1


@pytest.mark.parametrize(
    ("reply", "allowed"),
    [("yes\n", True), ("y\n", False), ("YES\n", False), ("\n", False)],
)
def test_prod_confirmation_requires_full_word_from_tty(
    reply: str, allowed: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "open", lambda *args, **kwargs: io.StringIO(reply))
    if allowed:
        dlq.confirm("prod", TOPIC, SUB)
    else:
        with pytest.raises(dlq.ReplayError, match="cancelled"):
            dlq.confirm("prod", TOPIC, SUB)


def test_http_transport_preserves_base64_json_and_keeps_credentials_out_of_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = []
    commands = []

    def token(*args: str) -> str:
        commands.append(args)
        return "test-access-token"

    class Opener:
        def open(self, request: Any, **kwargs: Any) -> io.BytesIO:
            requests.append(request)
            return io.BytesIO(b'{"messageIds":["published"]}')

    monkeypatch.setattr(dlq, "gcloud", token)
    monkeypatch.setattr(urllib.request, "build_opener", lambda *args: Opener())
    client = dlq.PubSub()
    client.publish(TOPIC, dlq.replay_message(received(PROTOBUF_CDC)["message"]))
    assert commands == [("auth", "print-access-token", "--quiet")]
    assert requests[0].get_header("Authorization") == "Bearer test-access-token"
    assert requests[0].host == "us-central1-pubsub.googleapis.com"
    assert (
        base64.b64decode(json.loads(requests[0].data)["messages"][0]["data"])
        == PROTOBUF_CDC
    )


def test_api_error_does_not_print_private_response_contents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Opener:
        def open(self, request: Any, **kwargs: Any) -> None:
            raise urllib.error.HTTPError(
                request.full_url,
                400,
                "private payload",
                Message(),
                io.BytesIO(b"private payload"),
            )

    monkeypatch.setattr(dlq, "gcloud", lambda *args: "private-token")
    monkeypatch.setattr(urllib.request, "build_opener", lambda *args: Opener())
    with pytest.raises(dlq.ReplayError, match=r"HTTP 400") as caught:
        dlq.PubSub().publish(TOPIC, {"data": ""})
    assert "private" not in str(caught.value)
