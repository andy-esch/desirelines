# Alert: frontend root uptime failing

**Symptom**: the Firebase Hosting frontend uptime check has failed for ≥2
minutes. Fires as CRITICAL to email + Slack.

**First place to look**:

- Console → Monitoring → Uptime checks → the frontend check, for per-region
  results.
- Firebase Console → Hosting → **Release history** — is a deploy mid-flight or
  recently rolled back?

**Likely causes** (ranked):

1. Firebase Hosting deployment mid-flight or rolled back.
2. DNS or SSL issue on the hosting domain.

**Quick mitigations**:

- Check the Hosting release history first. A deploy in progress usually explains
  a brief failure and self-resolves.
- If a bad release shipped, roll back to the previous release from the Console.

**If still stuck**: check whether `apigateway-uptime-failing.md` is also firing.
Both together points at Hosting or DNS; frontend alone points at the static
deploy itself. Note the frontend is a static site — if it is down but the API is
up, no data is at risk, only access to the UI.
