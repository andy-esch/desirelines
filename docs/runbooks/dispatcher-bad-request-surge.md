# Alert: dispatcher 400 surge (webhook tampering)

**Symptom**: dispatcher returning 400 (Bad Request) at >5/min sustained for 5
minutes. Fires as HIGH to email + Slack. Legitimate Strava webhook payloads are
well-formed, so bursts of 400 indicate someone is hitting `/webhook` with
crafted or replayed payloads.

**First place to look**:

- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-dispatcher"
  httpRequest.status=400
  ```

  The rejection reason distinguishes proto deserialization failure vs signature
  mismatch vs a missing required field.

**Likely causes** (ranked):

1. Crafted or replayed payloads from a non-Strava origin.
2. A real Strava-side schema change — Strava added a required field and our
   proto has not caught up.

**Quick mitigations**:

- Inspect source IPs. Strava webhook traffic comes from documented Strava IP
  ranges; any other origin is the actor.
- If volume threatens capacity, block at Cloud Run ingress or via Cloud Armor.
- If Strava changed the schema: update the proto and redeploy.

**If still stuck**: distinguish tampering from a schema change by checking
whether *any* webhooks are still succeeding. All-400 means a schema break;
mixed means an external actor alongside healthy traffic. Cross-check
`webhook-events-absent.md` if successful events have stopped entirely.
