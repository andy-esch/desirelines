# Alert: Pub/Sub — old unacked messages

**Symptom**: the oldest unacked message in a subscription is older than 5
minutes, indicating a processing backlog. Fires as HIGH to email + Slack.

**First place to look**:

- Console → Pub/Sub → Subscriptions → check **Oldest unacked message age** and
  **Unacked message count** to identify the backed-up subscription.
- Console → Cloud Run → the consuming service → **Metrics** — is it scaling, or
  pinned at its instance cap?

**Likely causes** (ranked):

1. The consuming service is not scaling — instance cap reached, or cold starts
   are slower than the arrival rate.
2. The consumer is slow because a dependency is slow (Neon wake, BigQuery).
3. The consumer is erroring and messages are being redelivered repeatedly —
   check whether the matching DLQ is also filling.

**Quick mitigations**:

- Check the consumer's error rate first: a backlog caused by failures needs a
  different fix than one caused by capacity.
- If it is capacity and the backlog is real, raising the service's max instances
  drains it.

**If still stuck**: a backlog that never drains usually means messages are
failing rather than queueing — follow `dlq-postgres-writer.md`,
`dlq-deletion-service.md` or `dlq-activity-rows.md` for the failing consumer.
