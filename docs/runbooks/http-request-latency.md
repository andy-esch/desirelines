# Alert: HTTP request P99 latency high

**Symptom**: P99 HTTP request duration (dispatcher + apigateway) sustained
above 15s for ≥10 minutes. Fires as MEDIUM to email + Slack.

Threshold context: 15s is the first histogram-bucket boundary above the ~10s
scale-to-zero cold-start ceiling. The 7-day aggregate P99 is ~4.1s and P50 is
~60ms — the tail is Cloud Run and Neon cold starts, which spike a sparse-traffic
window's P99 to ~10s. The alert duration (600s) is deliberately longer than the
5m rate window, so a single cold start clears before firing. Only sustained
degradation pages. Min-instance mitigation was declined to keep scale-to-zero
cost savings.

**First place to look**:

- Console → Monitoring → Metrics Explorer → `desirelines.io/http/request.duration`
  P99. The shape matters: isolated spikes on low traffic vs a sustained plateau.

**Likely causes** (ranked):

1. Cold-start bursts on sparse traffic. Expected, and the duration filter should
   normally absorb them — if this fired, look for a plateau instead.
2. Sustained Cloud Run or Neon degradation.
3. A recent deploy that added work to the request path.

**Quick mitigations**:

- Distinguish burst from sustained first. That single question routes the whole
  triage.
- If sustained: check Cloud Run and Neon health, then recent deploys.

**If still stuck**: see `postgres-query-latency.md` — request latency is often
just query latency surfacing one layer up. `reading-traces.md` has the
slow-pattern table for pinning down which span dominates.
