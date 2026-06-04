"""Unit tests for postgres_writer_app FastAPI endpoints.

Tests the HTTP interface layer using FastAPI's TestClient, with mocked service
layer to isolate endpoint logic from business logic and external dependencies.

Activity data is now provided inline in the enriched event (raw_activity field)
rather than fetched from the Strava API.
"""

import json
import time
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

from stravapipe.cloudrun.postgres_writer_app import app

from .conftest import (
    SAMPLE_RAW_ACTIVITY,
    SAMPLE_RAW_ACTIVITY_NO_POLYLINE,
    SAMPLE_RAW_ACTIVITY_WITH_MAP,
    make_cloudevent_headers,
    make_pubsub_body,
    make_webhook_payload,
)


@pytest.fixture
def mock_postgres_config():
    """Mock configuration to skip validation at startup."""
    with patch(
        "stravapipe.cloudrun.postgres_writer_app.load_postgres_writer_config"
    ) as mock:
        mock.return_value = MagicMock()
        yield mock


@pytest.fixture
def client(mock_postgres_config):
    """Create a test client with mocked configuration."""
    from stravapipe.cloudrun.postgres_writer_app import app

    with patch(
        "stravapipe.cloudrun.postgres_writer_app.create_session_factory"
    ) as mock_factory:
        mock_factory.return_value = (MagicMock(), MagicMock())
        with TestClient(app) as client:
            # Override the MagicMock timeout that lifespan picked up from the
            # mocked config — asyncio.wait_for needs a real number.
            app.state.readiness_timeout = 5.0
            yield client


class TestHealthEndpoint:
    """Tests for /health endpoint."""

    def test_health_returns_healthy_status(self, client):
        """Health endpoint returns 200 with healthy status."""
        response = client.get("/health")

        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}


class TestReadyEndpoint:
    """Tests for /ready endpoint — exercises Postgres dependency probe."""

    def test_ready_returns_200_when_postgres_reachable(self, client):
        """Successful SELECT 1 returns 200 with healthy components."""
        from stravapipe.cloudrun.postgres_writer_app import app

        mock_session = MagicMock()
        mock_session.__enter__.return_value = mock_session
        mock_session.__exit__.return_value = False
        mock_session_factory = MagicMock(return_value=mock_session)
        app.state.session_factory = mock_session_factory

        response = client.get("/ready")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "healthy"
        assert body["components"] == {"postgres": "healthy"}
        mock_session.execute.assert_called_once()

    def test_ready_returns_503_when_postgres_errors(self, client):
        """Connection error returns 503 with error string."""
        from stravapipe.cloudrun.postgres_writer_app import app

        mock_session_factory = MagicMock(side_effect=RuntimeError("connection refused"))
        app.state.session_factory = mock_session_factory

        response = client.get("/ready")

        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "unhealthy"
        assert body["components"] == {"postgres": "unhealthy"}
        assert "connection refused" in body["errors"]["postgres"]

    def test_ready_returns_503_on_timeout(self, client):
        """A probe that exceeds the timeout returns 503 with timeout marker."""

        def _slow_factory():
            time.sleep(0.5)
            return MagicMock()

        app.state.session_factory = _slow_factory
        app.state.readiness_timeout = 0.01

        # Patch retry backoff to 0 so the test doesn't pay the production
        # 1s pause for each persistent failure.
        with patch("stravapipe.shared.readiness.DEFAULT_READINESS_RETRY_BACKOFF", 0):
            response = client.get("/ready")

        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "unhealthy"
        assert "timeout" in body["errors"]["postgres"]


class TestPostEndpointValidation:
    """Tests for POST / endpoint - validation and error handling."""

    def test_missing_cloudevent_headers_returns_400(self, client):
        """Request without CloudEvent headers returns 400."""
        response = client.post(
            "/",
            json=make_pubsub_body(make_webhook_payload()),
        )

        assert response.status_code == 400
        assert "Missing required CloudEvent headers" in response.json()["detail"]

    def test_missing_ce_type_header_returns_400(self, client):
        """Request without ce-type header returns 400."""
        headers = make_cloudevent_headers()
        del headers["ce-type"]

        response = client.post(
            "/",
            headers=headers,
            json=make_pubsub_body(make_webhook_payload()),
        )

        assert response.status_code == 400

    def test_invalid_json_body_returns_400(self, client):
        """Request with invalid JSON body returns 400."""
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            content="not valid json",
        )

        assert response.status_code == 400

    def test_invalid_pubsub_envelope_returns_422(self, client):
        """Request with invalid Pub/Sub envelope returns 422."""
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json={"not": "a pubsub message"},
        )

        assert response.status_code == 422

    def test_invalid_webhook_payload_returns_422(self, client):
        """Request with invalid webhook data returns 422."""
        invalid_webhook = {"aspect_type": "create"}  # Missing required fields

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(invalid_webhook),
        )

        assert response.status_code == 422

    def test_invalid_object_type_returns_422(self, client):
        """Webhook with unsupported object_type returns 422."""
        webhook = make_webhook_payload()
        webhook["object_type"] = "athlete"  # Only "activity" is supported

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(webhook),
        )

        assert response.status_code == 422


class TestCreateEventHandling:
    """Tests for CREATE aspect_type handling."""

    def test_create_event_success(self, client):
        """CREATE event with raw_activity writes to PostgreSQL."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True
        mock_activity = MagicMock()

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=mock_activity,
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "created"
            assert data["activity_id"] == 12345678
            mock_uow.activities.insert.assert_called_once_with(mock_activity)

    def test_create_event_already_exists(self, client):
        """CREATE event for existing activity returns skipped."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = False  # Already exists
        mock_activity = MagicMock()

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=mock_activity,
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "skipped"
            assert data["reason"] == "already_exists"

    def test_create_event_with_polyline_inserts_route(self, client):
        """CREATE event with map.polyline also inserts route geometry."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True
        mock_uow.activities.insert_route.return_value = True

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY_WITH_MAP
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            assert response.json()["status"] == "created"
            mock_uow.activities.insert.assert_called_once()
            mock_uow.activities.insert_route.assert_called_once()
            # Verify geojson argument is a valid GeoJSON string
            call_args = mock_uow.activities.insert_route.call_args
            assert call_args[0][0] == 12345678  # activity_id

            geojson = json.loads(call_args[0][1])
            assert geojson["type"] == "LineString"

    def test_create_event_without_polyline_skips_route(self, client):
        """CREATE event with null polyline does not insert route."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY_NO_POLYLINE
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            assert response.json()["status"] == "created"
            mock_uow.activities.insert_route.assert_not_called()

    def test_create_event_without_map_skips_route(self, client):
        """CREATE event without map field does not insert route."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            assert response.json()["status"] == "created"
            mock_uow.activities.insert_route.assert_not_called()

    def test_create_event_duplicate_skips_route(self, client):
        """CREATE event for existing activity skips route insert too."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = False  # Already exists

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY_WITH_MAP
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            assert response.json()["status"] == "skipped"
            mock_uow.activities.insert_route.assert_not_called()

    def test_create_event_missing_raw_activity(self, client):
        """CREATE event without raw_activity returns skipped."""
        webhook = make_webhook_payload(aspect_type="create")
        # No raw_activity field

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(webhook),
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "skipped"
        assert data["reason"] == "activity_not_found"


class TestUpdateEventHandling:
    """Tests for UPDATE aspect_type handling."""

    def test_update_event_no_relevant_updates_skipped(self, client):
        """UPDATE event with no relevant changes is skipped."""
        webhook = make_webhook_payload(aspect_type="update")
        webhook["updates"] = {"private": "true"}  # Not relevant (title/type)

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(webhook),
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "skipped"
        assert data["reason"] == "no_relevant_updates"

    def test_update_event_with_title_update(self, client):
        """UPDATE event with title change updates activity."""
        webhook = make_webhook_payload(aspect_type="update")
        webhook["updates"] = {"title": "New Title"}

        mock_uow = MagicMock()
        mock_uow.activities.exists.return_value = True
        mock_uow.activities.update_metadata.return_value = True

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "updated"

    def test_update_event_skips_missing_activity(self, client):
        """UPDATE event skips activity not in PostgreSQL (no backfill)."""
        webhook = make_webhook_payload(aspect_type="update")
        webhook["updates"] = {"type": "Run"}

        mock_uow = MagicMock()
        mock_uow.activities.exists.return_value = False  # Not in DB

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "skipped"
            assert data["reason"] == "not_found"

    def test_update_event_enriched_refreshes_via_upsert(self, client):
        """UPDATE carrying raw_activity (type change) refreshes the row via upsert."""
        # Dispatcher re-fetched the activity, so the enriched UPDATE carries the
        # full payload with the granular sport_type.
        webhook = make_webhook_payload(
            aspect_type="update", raw_activity=SAMPLE_RAW_ACTIVITY
        )
        webhook["updates"] = {"type": "Run"}

        mock_uow = MagicMock()

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

        assert response.status_code == 200
        assert response.json()["status"] == "updated"
        # Enriched path upserts the full activity; it must NOT go through the
        # lossy bare metadata path.
        mock_uow.activities.upsert.assert_called_once()
        mock_uow.activities.update_metadata.assert_not_called()
        upserted = mock_uow.activities.upsert.call_args.args[0]
        assert upserted.sport == "Run"  # granular sport_type from raw_activity

    def test_update_event_bare_type_uses_metadata_path(self, client):
        """UPDATE without raw_activity (fetch failed / title-only) stays on the
        bare metadata path and never upserts."""
        webhook = make_webhook_payload(aspect_type="update")  # no raw_activity
        webhook["updates"] = {"type": "Ride"}

        mock_uow = MagicMock()
        mock_uow.activities.exists.return_value = True
        mock_uow.activities.update_metadata.return_value = True

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

        assert response.status_code == 200
        assert response.json()["status"] == "updated"
        mock_uow.activities.upsert.assert_not_called()
        mock_uow.activities.update_metadata.assert_called_once_with(
            12345678, {"type": "Ride"}
        )


class TestDeleteEventHandling:
    """Tests for DELETE aspect_type handling."""

    def test_delete_event_success(self, client):
        """DELETE event successfully removes activity."""
        mock_uow = MagicMock()
        mock_uow.activities.delete.return_value = True

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(make_webhook_payload(aspect_type="delete")),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "deleted"
            assert data["activity_id"] == 12345678

    def test_delete_event_not_found(self, client):
        """DELETE event for non-existent activity returns skipped."""
        mock_uow = MagicMock()
        mock_uow.activities.delete.return_value = False  # Not found

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(make_webhook_payload(aspect_type="delete")),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "skipped"
            assert data["reason"] == "not_found"


class TestErrorHandling:
    """Tests for error handling behavior."""

    def test_unexpected_error_returns_500(self, client):
        """Unexpected errors return 500 to trigger Pub/Sub retry."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.side_effect = RuntimeError("Database error")

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=MagicMock(),
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 500
            assert "internal server error" in response.json()["detail"]

    def test_malformed_raw_activity_returns_422(self, client):
        """Pydantic ValidationError → 422 so Pub/Sub acks instead of retrying."""
        webhook = make_webhook_payload(
            aspect_type="create",
            raw_activity={"clearly": "not a valid strava activity"},
        )
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(webhook),
        )

        assert response.status_code == 422
        assert "raw_activity" in response.json()["detail"]

    def test_malformed_raw_activity_on_update_returns_422(self, client):
        """Enriched UPDATE with a malformed raw_activity also 422s (same parse path)."""
        webhook = make_webhook_payload(
            aspect_type="update",
            raw_activity={"clearly": "not a valid strava activity"},
        )
        webhook["updates"] = {"type": "Ride"}

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(webhook),
        )

        assert response.status_code == 422
        assert "raw_activity" in response.json()["detail"]


class TestFreshnessEmission:
    """End-to-end webhook freshness histogram emission (anchors SLO 3).

    Exercises `_record_freshness` via the success path of each handler
    when the dispatcher stamps the `dispatcher_received_at_unix_ms`
    attribute. The CREATE-only emission shipped earlier and the
    UPDATE/DELETE extension landed in
    `feat/extend-webhook-freshness-metric-to-update-and-delete`; this
    class is the unit-level safety net added in the
    `add-postgres-writer-app-test-fixture-for-dispatcher-received-at`
    follow-up so regressions are caught before post-deploy verification.
    """

    def _mock_freshness_histogram(self):
        """Replace `app.state.freshness_histogram` with a MagicMock.

        The lifespan creates a real OTel Histogram; we need to swap it
        so the test can assert on `.record(...)` calls. Returns the mock
        so the test body can inspect it.
        """
        from stravapipe.cloudrun.postgres_writer_app import app

        mock = MagicMock()
        app.state.freshness_histogram = mock
        return mock

    def test_create_emits_freshness_when_attribute_present(self, client):
        """CREATE success path records to the histogram with aspect_type=create."""
        import time

        mock_histogram = self._mock_freshness_histogram()
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True

        received_at_ms = int(time.time() * 1000) - 500  # 500ms in the past

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=MagicMock(map=None),
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(
                    webhook, dispatcher_received_at_ms=received_at_ms
                ),
            )

        assert response.status_code == 200
        assert response.json()["status"] == "created"
        mock_histogram.record.assert_called_once()
        elapsed_ms, labels = mock_histogram.record.call_args.args
        assert 0 < elapsed_ms < 60_000  # sane bound: anything > 1 minute means a bug
        assert labels == {"aspect_type": "create"}

    def test_clock_skew_negative_is_clamped_not_dropped(self, client):
        """A dispatcher clock ahead of the writer yields negative elapsed; clamp
        to 0 so OTel doesn't silently drop the (forward-traffic) sample."""
        import time

        mock_histogram = self._mock_freshness_histogram()
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True

        # Dispatcher timestamp 5s in the FUTURE relative to the writer's clock.
        received_at_ms = int(time.time() * 1000) + 5000

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=MagicMock(map=None),
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(
                    webhook, dispatcher_received_at_ms=received_at_ms
                ),
            )

        assert response.status_code == 200
        mock_histogram.record.assert_called_once()
        elapsed_ms, _labels = mock_histogram.record.call_args.args
        assert elapsed_ms == 0.0  # clamped, not a negative that OTel would drop

    def test_missing_dispatcher_timestamp_skips_and_logs(self, client):
        """No dispatcher timestamp → don't record, but log (not silent) so the
        skip rate stays observable."""
        mock_histogram = self._mock_freshness_histogram()
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=MagicMock(map=None),
            ),
            patch("stravapipe.cloudrun.postgres_writer_app.logger") as mock_logger,
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            # No dispatcher_received_at_ms on the envelope.
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

        assert response.status_code == 200
        mock_histogram.record.assert_not_called()
        assert mock_logger.warning.called
        warn_kwargs = mock_logger.warning.call_args.kwargs
        assert warn_kwargs.get("extra", {}).get("aspect_type") == "create"

    def test_update_emits_freshness_when_attribute_present(self, client):
        """UPDATE success path records to the histogram with aspect_type=update."""
        import time

        mock_histogram = self._mock_freshness_histogram()
        mock_uow = MagicMock()
        mock_uow.activities.exists.return_value = True
        mock_uow.activities.update_metadata.return_value = True

        received_at_ms = int(time.time() * 1000) - 500

        webhook = make_webhook_payload(aspect_type="update")
        webhook["updates"] = {"title": "Renamed"}

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(
                    webhook, dispatcher_received_at_ms=received_at_ms
                ),
            )

        assert response.status_code == 200
        assert response.json()["status"] == "updated"
        mock_histogram.record.assert_called_once()
        elapsed_ms, labels = mock_histogram.record.call_args.args
        assert 0 < elapsed_ms < 60_000
        assert labels == {"aspect_type": "update"}

    def test_enriched_update_emits_freshness_when_attribute_present(self, client):
        """Enriched UPDATE (raw_activity) records freshness with aspect_type=update."""
        import time

        mock_histogram = self._mock_freshness_histogram()
        mock_uow = MagicMock()

        received_at_ms = int(time.time() * 1000) - 500

        webhook = make_webhook_payload(
            aspect_type="update", raw_activity=SAMPLE_RAW_ACTIVITY
        )
        webhook["updates"] = {"type": "Run"}

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(
                    webhook, dispatcher_received_at_ms=received_at_ms
                ),
            )

        assert response.status_code == 200
        assert response.json()["status"] == "updated"
        mock_uow.activities.upsert.assert_called_once()
        mock_histogram.record.assert_called_once()
        _elapsed_ms, labels = mock_histogram.record.call_args.args
        assert labels == {"aspect_type": "update"}

    def test_delete_emits_freshness_when_attribute_present(self, client):
        """DELETE success path records to the histogram with aspect_type=delete."""
        import time

        mock_histogram = self._mock_freshness_histogram()
        mock_uow = MagicMock()
        mock_uow.activities.delete.return_value = True

        received_at_ms = int(time.time() * 1000) - 500

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(
                    make_webhook_payload(aspect_type="delete"),
                    dispatcher_received_at_ms=received_at_ms,
                ),
            )

        assert response.status_code == 200
        assert response.json()["status"] == "deleted"
        mock_histogram.record.assert_called_once()
        elapsed_ms, labels = mock_histogram.record.call_args.args
        assert 0 < elapsed_ms < 60_000
        assert labels == {"aspect_type": "delete"}

    def test_no_emission_when_attribute_missing(self, client):
        """No `dispatcher_received_at_unix_ms` attribute → no record() call.

        Guards the early-return branch in `_record_freshness`. Covers the
        pre-rollout / legacy-message case where the dispatcher hadn't
        started stamping the attribute yet.
        """
        mock_histogram = self._mock_freshness_histogram()
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=MagicMock(map=None),
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),  # no dispatcher_received_at_ms
            )

        assert response.status_code == 200
        assert response.json()["status"] == "created"
        mock_histogram.record.assert_not_called()


class TestIdempotency:
    """Idempotency: redelivery of the same CloudEvent must not corrupt state."""

    def test_create_event_idempotent_on_redelivery(self, client):
        """First delivery returns CREATED, second returns SKIPPED/ALREADY_EXISTS."""
        mock_uow = MagicMock()
        # First call inserts (returns True); second call detects duplicate.
        mock_uow.activities.insert.side_effect = [True, False]
        mock_activity = MagicMock()

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=mock_activity,
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            body = make_pubsub_body(webhook)
            headers = make_cloudevent_headers()

            r1 = client.post("/", headers=headers, json=body)
            r2 = client.post("/", headers=headers, json=body)

            assert r1.status_code == 200
            assert r1.json()["status"] == "created"

            assert r2.status_code == 200
            assert r2.json()["status"] == "skipped"
            assert r2.json()["reason"] == "already_exists"

            assert mock_uow.activities.insert.call_count == 2

    def test_update_event_idempotent_on_redelivery(self, client):
        """Same UPDATE event posted twice succeeds both times with identical args.

        ``update_metadata`` is idempotent at the adapter layer (UPDATE row
        SET title=X applied twice yields the same state). The handler must
        not error or change behavior on a redelivery.
        """
        webhook = make_webhook_payload(aspect_type="update")
        webhook["updates"] = {"title": "New Title"}

        mock_uow = MagicMock()
        mock_uow.activities.exists.return_value = True
        mock_uow.activities.update_metadata.return_value = True

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            body = make_pubsub_body(webhook)
            headers = make_cloudevent_headers()

            r1 = client.post("/", headers=headers, json=body)
            r2 = client.post("/", headers=headers, json=body)

            assert r1.status_code == 200
            assert r2.status_code == 200
            assert r1.json()["status"] == "updated"
            assert r2.json()["status"] == "updated"
            assert mock_uow.activities.update_metadata.call_count == 2

            for call in mock_uow.activities.update_metadata.call_args_list:
                assert call.args[0] == 12345678
                assert call.args[1] == {"title": "New Title"}


class TestLifespanCleanup:
    """Tests for application lifespan cleanup events."""

    def test_engine_disposal_on_shutdown(self, mock_postgres_config):
        """SQLAlchemy engine is disposed when the app shuts down."""
        from stravapipe.cloudrun.postgres_writer_app import app

        mock_engine = MagicMock()
        mock_factory = MagicMock()

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.create_session_factory",
            return_value=(mock_engine, mock_factory),
        ):
            # TestClient context manager triggers startup and shutdown events
            with TestClient(app):
                # Startup events have run
                assert app.state.db_engine == mock_engine
                mock_engine.dispose.assert_not_called()

            # Shutdown events have run
            mock_engine.dispose.assert_called_once()
