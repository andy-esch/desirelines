# Alert: No Strava webhook events received in 24h

**Symptom**: zero increments to
`custom.googleapis.com/desirelines.io/webhook/events` over a rolling
24h window.

**First place to look**:
- Strava status page: https://status.strava.com
- Cloud Logging filter:
  `resource.type="cloud_run_revision"
   resource.labels.service_name="desirelines-dispatcher"
   "webhook"`
- GCP Console → Monitoring → Metrics Explorer — query the
  `webhook/events` custom metric to see whether the stream is flat
  or absent.

**Likely causes** (ranked):
1. Strava OAuth revoked or token refresh failure.
2. Strava webhook subscription dropped server-side.
3. Dispatcher silently failing in webhook handler.
4. Strava-side outage.

**Quick mitigations**:
- Manual test: upload an activity to Strava, watch dispatcher logs
  for webhook arrival.
- Re-create the Strava webhook subscription if missing (see
  `docs/guides/strava-webhook.md`).
- Force OAuth token refresh from Firestore (procedure: TBD per
  ops-page Q3).

**If still stuck**: check dispatcher's `webhook_events_total` raw
data in Cloud Monitoring metrics explorer — is the metric stream
present at all? If yes but flat, the dispatcher is receiving and
parsing webhooks but not incrementing — proto/handler bug. If
absent, no webhooks are arriving at all — Strava-side problem.
