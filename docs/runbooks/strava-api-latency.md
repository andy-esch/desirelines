# Alert: Strava API P99 latency high

**Symptom**: P99 Strava API call duration sustained above 1500ms for ≥10
minutes. Fires as MEDIUM to email + Slack.

Threshold context: tuned from a 7-day observed P99 of ~750ms (worst `operation`
label), with a 2× margin for legitimate burstiness.

**First place to look**:

- Strava status page: <https://status.strava.com>. Strava's own latency
  dominates this metric — check here before assuming it is us.
- Console → Monitoring → Metrics Explorer → the Strava API duration metric,
  grouped by `operation`.

**Likely causes** (ranked):

1. Strava-side slowness or a partial outage. By far the most common.
2. Strava rate-limiting us, which manifests as slow or queued calls.
3. Network egress issues from Cloud Run (rare).

**Quick mitigations**:

- If Strava's status page shows an incident, there is nothing to fix — the
  alert is informational and will auto-close.
- If Strava looks healthy, check whether one `operation` dominates the tail;
  that points at a specific call site.

**If still stuck**: sustained Strava latency can cascade into dispatcher
timeouts. Check `slo-1-dispatcher-availability.md` — if the dispatcher SLO is
also burning, the webhook path is being held up by these calls.
