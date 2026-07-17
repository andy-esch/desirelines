# Alert: Strava sport_type with no registry mapping

**Symptom**: apigateway or stravapipe saw a Strava `sport_type` value with no
entry in `schemas/sports/sport_types.json`. Fires as HIGH to email + Slack. The
activity was bucketed into the "other" category so the user can still see it,
but until the registry is updated all future activities of this type also land
in "other" instead of their proper bucket.

**First place to look**:

- The alert's `unmapped_sport_type` label names the exact Strava enum value
  (e.g. `HighIntensityIntervalTraining`). That is usually the whole diagnosis.

**Likely causes** (ranked):

1. Strava added a new `SportType` enum value upstream.
2. A sport exists upstream that the registry never covered.

**Quick mitigations**:

1. Cross-check against Strava's current `SportType` enum:
   `just check-upstream-sports` (or the Strava swagger spec →
   <https://developers.strava.com/swagger/swagger.json> → `SportType`).
2. Add the value to the most fitting category in
   `schemas/sports/sport_types.json`. If none fits, leaving it in "other" is a
   valid permanent state.
3. Run `just sync-schemas && just verify-schemas` and open a PR.
4. Once deployed, the alert auto-closes after 1h with no fresh firings.

**If still stuck**: nothing is broken — this alert is a data-quality signal, not
an outage. The activity is visible to the user either way.

> **Dedup note**: each Cloud Run instance emits only one warning per unmapped
> type. A quiet alert does **not** mean the unmapped type stopped arriving — it
> may just mean the instance has not recycled. Check the "other" category counts
> on the dashboard to see ongoing volume.
