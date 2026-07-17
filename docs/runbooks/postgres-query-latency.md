# Alert: Postgres query P99 latency high

**Symptom**: P99 Postgres query duration sustained above 15s for ≥10 minutes.
Fires as MEDIUM to email + Slack. Typical queries are fast (~50ms, indexed
lookups).

Threshold context: 15s is the first histogram-bucket boundary above the ~10s
scale-to-zero cold-start ceiling. The 7-day aggregate P99 is ~4.3s — the tail is
Neon scale-to-zero compute wake on the first query after idle. The alert
duration (600s) is deliberately longer than the 5m rate window so a single wake
clears before firing. Always-on Neon was declined to keep scale-to-zero savings.

**First place to look**:

- Console → Monitoring → Metrics Explorer → `desirelines.io/postgres/query.duration`
  P99, grouped by the `operation` label.
- Neon dashboard: was the compute suspended and waking?

**Likely causes** (ranked):

1. Isolated Neon compute wake on sparse traffic. Expected.
2. Sustained slow queries — a missing index or lock contention.
3. A recent migration that changed a query plan.

**Quick mitigations**:

- Distinguish isolated wake (spikes on low traffic) from sustained slowness.
- If sustained: inspect the slow queries by `operation` label and check recent
  migrations.

**If still stuck**: see `postgres-pool-exhaustion.md` — slow queries hold
connections, so these two alerts frequently fire together and share a cause.
