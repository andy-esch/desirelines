"""Replay DLQ messages without decoding binary payloads into shell arguments."""

from __future__ import annotations

import argparse
import base64
import binascii
import json
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any
import urllib.error
import urllib.request


class ReplayError(Exception):
    """An operation failed without exposing credentials or message contents."""


def gcloud(*args: str) -> str:
    executable = shutil.which("gcloud")
    if executable is None:
        raise ReplayError("gcloud is not installed")
    try:
        return subprocess.check_output(  # noqa: S603 - fixed internal subcommands, no shell/user arguments.
            [executable, *args], text=True, stderr=subprocess.PIPE, timeout=30
        ).strip()
    except (OSError, subprocess.SubprocessError) as error:
        raise ReplayError(
            "gcloud failed; check authentication and configuration"
        ) from error


def destinations(service: str, environment: str) -> tuple[str, str, str]:
    if environment not in ("dev", "prod"):
        raise ReplayError("Environment must be dev or prod")
    topics = {
        "postgres-writer": "desirelines_activity_events",
        "deletion-service": "desirelines_deauth_events",
        "activity-rows": f"desirelines-activity-rows-{environment}",
    }
    if service not in topics:
        raise ReplayError("Unsupported service")
    project = f"desirelines-{environment}"
    root = f"projects/{project}"
    return (
        project,
        f"{root}/topics/{topics[service]}",
        f"{root}/subscriptions/desirelines-{service}-dlq-monitoring-{environment}",
    )


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


class PubSub:
    def __init__(self) -> None:
        self.token: str | None = None
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if self.token is None:
            self.token = gcloud("auth", "print-access-token", "--quiet")
        # Preserve ordering keys through the application's publishing region.
        host = (
            "us-central1-pubsub.googleapis.com"
            if path.endswith(":publish")
            else "pubsub.googleapis.com"
        )
        request = urllib.request.Request(
            f"https://{host}/v1/{path}",
            data=json.dumps(body).encode() if body is not None else None,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            method=method,
        )
        try:
            with self.opener.open(request, timeout=45) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            raise ReplayError(f"Pub/Sub {method} failed (HTTP {error.code})") from None
        except (OSError, ValueError) as error:
            raise ReplayError(
                f"Pub/Sub {method} failed or returned invalid JSON"
            ) from error
        if not isinstance(result, dict):
            raise ReplayError("Pub/Sub returned an invalid response")
        return result

    def encoding(self, topic: str, service: str) -> str:
        settings = self.request("GET", topic).get("schemaSettings")
        if settings is None:
            return "JSON"
        if not isinstance(settings, dict):
            raise ReplayError("Invalid topic schema settings")
        encoding = settings.get("encoding")
        if encoding not in ("JSON", "BINARY") or (
            encoding == "BINARY" and service != "activity-rows"
        ):
            raise ReplayError("Unsupported topic encoding for this service")
        return str(encoding)

    def pull(self, subscription: str) -> list[dict[str, Any]]:
        messages = self.request(
            "POST", f"{subscription}:pull", {"maxMessages": 50}
        ).get("receivedMessages", [])
        if not isinstance(messages, list) or any(
            not isinstance(m, dict) for m in messages
        ):
            raise ReplayError("Invalid pull response")
        return messages

    def publish(self, topic: str, message: dict[str, Any]) -> None:
        ids = self.request("POST", f"{topic}:publish", {"messages": [message]}).get(
            "messageIds"
        )
        if (
            not isinstance(ids, list)
            or len(ids) != 1
            or not isinstance(ids[0], str)
            or not ids[0]
        ):
            raise ReplayError(
                "Publish did not confirm exactly one message; original will not be acknowledged"
            )

    def ack(self, subscription: str, ack_ids: list[str]) -> None:
        self.request("POST", f"{subscription}:acknowledge", {"ackIds": ack_ids})

    def release(self, subscription: str, ack_ids: list[str]) -> None:
        for offset in range(0, len(ack_ids), 50):
            self.request(
                "POST",
                f"{subscription}:modifyAckDeadline",
                {
                    "ackIds": ack_ids[offset : offset + 50],
                    "ackDeadlineSeconds": 0,
                },
            )


def replay_message(message: Any) -> dict[str, Any]:
    if not isinstance(message, dict):
        raise ReplayError("Invalid message")
    data = message.get("data", "")
    attributes = message.get("attributes", {})
    if (
        not isinstance(data, str)
        or not isinstance(attributes, dict)
        or any(
            not isinstance(k, str) or not isinstance(v, str)
            for k, v in attributes.items()
        )
    ):
        raise ReplayError("Invalid message data or attributes")
    try:
        base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ReplayError("Invalid base64 payload") from error
    # Forwarded message data is already the original payload. Do not unwrap
    # application JSON or trust validation metadata from the previous publish.
    result: dict[str, Any] = {
        "data": data,
        "attributes": {
            k: v
            for k, v in attributes.items()
            if not k.startswith(("CloudPubSubDeadLetter", "googclient_schema"))
            and k
            not in ("dispatcher_received_at_unix_ms", "googclient_deliveryattempt")
        },
    }
    result["attributes"]["replayed_from_dlq"] = "true"
    ordering_key = message.get("orderingKey", "")
    if not isinstance(ordering_key, str):
        raise ReplayError("Invalid ordering key")
    if ordering_key:
        result["orderingKey"] = ordering_key
    return result


def summary(message: dict[str, Any], encoding: str) -> str:
    if encoding == "JSON":
        try:
            event = json.loads(base64.b64decode(message["data"]))
            if isinstance(event, dict):
                return json.dumps(
                    {
                        k: event.get(k)
                        for k in (
                            "aspect_type",
                            "object_type",
                            "object_id",
                            "event_time",
                        )
                    }
                )
        except (ValueError, UnicodeError):
            pass
    return f"{encoding} payload (contents omitted)"


def identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ReplayError(f"Pull response is missing a valid {label} ID")
    return value


def release_pending(
    client: PubSub, subscription: str, pending: list[str]
) -> ReplayError | None:
    if pending:
        try:
            client.release(subscription, list(dict.fromkeys(pending)))
        except ReplayError as failure:
            print(
                "Could not release all leases; they will expire without acknowledgement.",
                file=sys.stderr,
            )
            return failure
    return None


def replay(
    client: PubSub, topic: str, subscription: str, encoding: str, *, dry_run: bool
) -> int:
    pending: list[str] = []
    seen: set[str] = set()
    inspected = 0
    error: ReplayError | None = None

    def publish_one(received: dict[str, Any]) -> bool:
        original = received.get("message")
        if not isinstance(original, dict):
            raise ReplayError("Invalid received message")
        message_id = identifier(original.get("messageId"), "message")
        if message_id in seen:
            return False
        message = replay_message(original)
        if not dry_run:
            client.publish(topic, message)
        seen.add(message_id)
        print(
            f"{'Would replay' if dry_run else 'Published'}: {summary(message, encoding)}"
        )
        return True

    try:
        while batch := client.pull(subscription):
            pending.extend(
                identifier(received.get("ackId"), "acknowledgement")
                for received in batch
            )
            confirmed: list[str] = []
            fresh = 0
            for received in batch:
                try:
                    fresh += int(publish_one(received))
                    if not dry_run:
                        confirmed.append(received["ackId"])
                except ReplayError as failure:
                    error = failure
                    break
            inspected += fresh
            if confirmed:
                client.ack(subscription, confirmed)
                acknowledged = set(confirmed)
                pending = [ack_id for ack_id in pending if ack_id not in acknowledged]
            if error is not None:
                break
            # Dry runs do not acknowledge messages; stop if the service returns
            # only redeliveries rather than counting them indefinitely.
            if dry_run and fresh == 0:
                break
    except ReplayError as failure:
        error = failure
    finally:
        cleanup_error = release_pending(client, subscription, pending)
        if error is None:
            error = cleanup_error
    if error is not None:
        raise error
    return inspected


def confirm(environment: str, topic: str, subscription: str) -> None:
    print(f"Replay {subscription} onto {topic}. Every subscriber receives it.")
    print("Only confirmed publishes are acknowledged out of the DLQ.")
    print(
        "Type 'yes' to confirm: " if environment == "prod" else "Continue? (y/N): ",
        end="",
        flush=True,
    )
    try:
        with Path("/dev/tty").open(encoding="utf-8") as tty:
            reply = tty.readline().strip()
    except OSError as error:
        raise ReplayError(
            "Execution requires interactive confirmation on /dev/tty"
        ) from error
    if (environment == "prod" and reply != "yes") or (
        environment == "dev" and reply not in ("y", "Y")
    ):
        raise ReplayError("Operation cancelled")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "service", choices=("postgres-writer", "deletion-service", "activity-rows")
    )
    parser.add_argument("environment", choices=("dev", "prod"))
    parser.add_argument(
        "--execute",
        action="store_true",
        help="publish and acknowledge; default is dry run",
    )
    args = parser.parse_args(argv)
    try:
        project, topic, subscription = destinations(args.service, args.environment)
        require_project(project)
        if args.execute:
            confirm(args.environment, topic, subscription)
        client = PubSub()
        encoding = client.encoding(topic, args.service)
        print(
            f"{'REPLAY' if args.execute else 'DRY RUN'}: {subscription} → {topic} ({encoding})"
        )
        count = replay(client, topic, subscription, encoding, dry_run=not args.execute)
        print(f"{'Replayed' if args.execute else 'Inspected'} {count} message(s).")
    except ReplayError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


def require_project(project: str) -> None:
    if gcloud("config", "get-value", "project") != project:
        raise ReplayError(
            f"Project mismatch; select {project} in gcloud before running"
        )


if __name__ == "__main__":
    raise SystemExit(main())
