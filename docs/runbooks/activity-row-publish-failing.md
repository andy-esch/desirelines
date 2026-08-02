# Alert: Activity-row publish failing

**Symptom**: the dispatcher is failing to publish activity rows to the BigQuery
CDC topic, sustained above 1/min for 10 minutes. Fires as MEDIUM.

**Why this is the only signal**: the publish is best-effort by construction —
every failure is logged, counted and swallowed so it cannot affect the webhook
response or the primary `activity_events` publish. Nothing else degrades
visibly, so this counter is the sole evidence the feature works.

**First place to look**: the `detail` label localizes the failure.

| `detail`  | means                                                              |
| --------- | ------------------------------------------------------------------ |
| `refetch` | Strava will not re-serve an activity that still exists — outage, rate limit, token problem |
| `build`   | the payload could not be mapped onto a row                          |
| `publish` | the row was built but Pub/Sub rejected it — topic missing, or IAM   |
| `panic`   | a bug in the mapping; should never appear                           |

`result="skipped"` is normal and does not page — an activity deleted before the
re-fetch legitimately produces no row.

```
resource.labels.service_name="desirelines-dispatcher"
jsonPayload.message=~"Activity-row publish failed|Failed to build activity row"
```

**Quick mitigations**:

- `publish` — confirm the dispatcher service account still holds
  `roles/pubsub.publisher` on the activity-rows topic.
- `refetch` — check Strava API health and cross-reference
  [strava-api-latency.md](strava-api-latency.md); usually self-resolves.
- Kill switch: set `dispatcher_activity_row_publish_enabled = false` and
  redeploy.

**If still stuck**: [dlq-activity-rows.md](dlq-activity-rows.md) covers rows
BigQuery received and refused. Both green while `activities_live` is stale means
the subscription itself has stalled, not the producer.
