# Alert: apigateway 404 surge (scanner activity)

**Symptom**: apigateway returning 404 at >5/min sustained for 5 minutes. Fires
as MEDIUM to email + Slack. Almost always a bot probing for common attack paths
(`/wp-admin`, `/.git/config`, `/.env`), since legitimate navigation does not
produce 404s.

**First place to look**:

- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-apigateway"
  httpRequest.status=404
  ```

  The 404 paths confirm scanner activity and reveal what is being probed.

**Likely causes** (ranked):

1. Automated scanner probing well-known paths. This is the overwhelming default.
2. A broken link or stale client requesting a removed route — check whether the
   paths look like real app routes rather than exploit paths.

**Quick mitigations**:

- If concentrated from a single IP or ASN: block at Firebase Hosting or Cloud
  Armor.
- If distributed and noisy: usually safe to ignore. Public Cloud Run URLs get
  this constantly. Document the IP range so the next triage is faster.

**If still stuck**: if the 404 paths are real app routes rather than exploit
paths, this is a routing bug, not a scanner — check recent route changes and
the Firebase Hosting rewrite rules.
