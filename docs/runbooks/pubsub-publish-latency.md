# Alert: Pub/Sub publish P99 latency high

**Symptom**: P99 Pub/Sub publish duration sustained above 500ms for ≥10 minutes.
Fires as MEDIUM to email + Slack. Publish is typically sub-100ms; sustained
slowness here blocks the dispatcher's webhook response path.

Threshold context: tuned from a 7-day observed P99 of ~250ms, with a 2× margin.

**First place to look**:

- Google Cloud status: <https://status.cloud.google.com>
- Console → Monitoring → Metrics Explorer → the Pub/Sub publish duration metric.

**Likely causes** (ranked):

1. Pub/Sub-side latency or a regional incident.
2. Publish retries under a transient error condition.
3. Network egress issues from Cloud Run.

**Quick mitigations**:

- Check Google Cloud status first — this metric is mostly a mirror of Pub/Sub
  health.
- Confirm whether the dispatcher's own request latency is rising in step; that
  tells you whether the publish delay is actually hurting the webhook path.

**If still stuck**: because publish sits on the dispatcher's synchronous path,
sustained slowness burns SLO 1. See `slo-1-dispatcher-availability.md`.
