# Alert: Ownership or admission checks failing

**Symptom**: the dispatcher's ownership/admission checks are returning errors at >1/min
sustained. Fires as MEDIUM to email + Slack. The handler fail-closes with 500
(so Strava retries up to 3×), but past the retry cap legitimate events are
dropped.

**First place to look**:

- Google Cloud status: <https://status.cloud.google.com>
- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-dispatcher"
  jsonPayload.error_code=("OWNERSHIP_CHECK_FAILED" OR "ALLOWLIST_CHECK_FAILED")
  ```

  The wrapped error names the specific Firestore failure.

**Likely causes** (ranked):

1. Firestore-side errors or a regional incident.
2. IAM drift — the dispatcher's service account lost `roles/datastore.user` on
   the user-configs database.
3. Sustained Firestore latency manifesting as timeouts.
4. Missing, inactive or conflicting ownership records. Inspect both directions
   using the [registry guide](../guides/activity-connection-registry.md); the
   [handler](../../packages/dispatcher/adapters/http/handler.go) never falls back
   to an athlete-shaped UID. A mapping change during enrichment can also surface
   as `STRAVA_FETCH_FAILED`, preserving the registry error in its cause.

**Quick mitigations**:

- Check Firestore status first.
- Verify the dispatcher service account still holds the datastore role on the
  user-configs database.

**If still stuck**: because this fails closed, sustained errors burn SLO 1 (the
dispatcher returns 500). See `slo-1-dispatcher-availability.md`. Also check
`firestore-operation-latency.md` — if latency is elevated, these errors are
probably timeouts rather than hard failures.

Contrast with `webhook-owner-check-orphan.md`: that one is a single-event
data-loss signal; this one is a sustained-rate availability signal.
