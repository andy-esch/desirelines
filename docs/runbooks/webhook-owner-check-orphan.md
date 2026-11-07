# Alert: Webhook for allowlisted athlete with no tokens (orphan)

**Symptom**: the dispatcher received a webhook for an athlete whose resolved app
UID is on the allowlist but has no Firestore tokens under an active ownership
pair. Fires as HIGH to email + Slack. The event
was acked (Strava will not retry) but nothing else happened — the activity is
lost unless the athlete re-authorizes.

**Alert shape**: fires on the FIRST orphan event. Orphan is a one-shot signal of
real data loss, not a sustained-rate condition — a genuine Firestore wipe shows
up as one or two events, not a sustained rate.

**First place to look**:

- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-dispatcher"
  "Orphan tokens"
  ```

  The log line names the affected athlete.
- Resolve the athlete through `provider_accounts/strava:{athleteID}` and inspect
  `users/{uid}/private/strava_tokens`. The UID is the registry record's app owner.
  See the [token-store checks](../../packages/dispatcher/adapters/firestore/token_store.go).

**Likely causes** (ranked):

1. **Firestore tokens deleted** — accidental delete, partial migration, or a
   deauth that was never followed by re-auth.
2. **Deauth/re-auth race** — a narrow window between token deletion and the
   re-auth callback writing new tokens. Self-resolves on the next event.
3. **Token write race** — concurrent refreshes lost a write. Should not happen
   given the optimistic-concurrency guard, but worth investigating if it recurs.

**Quick mitigations**:

- If the document is genuinely missing, ask the user to re-authorize via the
  app's OAuth flow. Webhooks resume on the next event.
- The already-acked event is not recoverable — Strava will not redeliver it.

**If still stuck**: if it recurs without an obvious cause, suspect a deletion
bug — check recent commits to the dispatcher's Firestore adapter. See
`webhook-owner-check-error.md` for ownership/admission failures. Those return 500
for redelivery and do not enter the orphan branch.
