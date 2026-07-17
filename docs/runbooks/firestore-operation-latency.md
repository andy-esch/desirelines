# Alert: Firestore operation P99 latency high

**Symptom**: P99 Firestore operation duration sustained above 1000ms for ≥10
minutes. Fires as MEDIUM to email + Slack.

Threshold context: confirmed from a 7-day observed P99 of ~490ms (worst
`operation` label); 2× observed gives the ~1000ms threshold.

**First place to look**:

- Google Cloud status: <https://status.cloud.google.com>
- Console → Monitoring → Metrics Explorer → the Firestore operation duration
  metric, grouped by `operation`.

**Likely causes** (ranked):

1. Firestore-side latency or a regional incident.
2. A hot document or contended write path.
3. Growth in the allowlist or token read volume on the webhook path.

**Quick mitigations**:

- Check Google Cloud status first.
- Identify which `operation` dominates the tail — the allowlist and token-store
  reads sit on the synchronous webhook path, so they matter most.

**If still stuck**: Firestore latency on the webhook path shows up as dispatcher
slowness. Cross-check `slo-1-dispatcher-availability.md` and
`webhook-owner-check-error.md` (allowlist read failures) if the dispatcher is
also degraded.
