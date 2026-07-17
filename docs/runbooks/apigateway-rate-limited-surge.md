# Alert: apigateway 429 surge (rate-limit engagement)

**Symptom**: apigateway's rate-limiter middleware returning 429 at >5/min
sustained for 5 minutes. Fires as HIGH to email + Slack. Either an external
flood attempt or a misbehaving legitimate client looping a request.

**First place to look**:

- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-apigateway"
  httpRequest.status=429
  ```

- Console → Monitoring → Metrics Explorer → `desirelines.io/ratelimit/rejected`,
  grouped by the `reason` label. `over_limit` means per-IP buckets are draining;
  `map_full` means the client map hit its cap, which is the IP-rotation flood
  signature.

**Likely causes** (ranked):

1. External flood or DOS attempt.
2. A legitimate client in a polling-loop bug. The web app uses TanStack Query
   with AbortSignal — runaway requests usually mean a missing abort.
3. A single aggressive scanner.

**Quick mitigations**:

- Check source IPs. Single source means likely deliberate; distributed means a
  distributed flood.
- Cross-check `apigateway-uptime-failing.md` — if uptime is still passing, the
  limiter is doing its job and this is informational rather than urgent.
- If adversarial: consider tightening the API rate-limit variables or putting
  Cloud Armor in front.

**If still stuck**: if `reason="map_full"` dominates, the per-IP client map is
saturated — that is an IP-rotation flood, and blocking individual IPs will not
help. Cloud Armor is the lever.
