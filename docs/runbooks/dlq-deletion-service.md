# Alert: DLQ — Deletion Service has messages

Pub/Sub could not confirm cleanup. Use the original event and publish time
to assess the remaining cleanup window. Inspect without acknowledging:

```bash
gcloud pubsub subscriptions pull desirelines-deletion-service-dlq-monitoring-<env> \
  --project=<project> --limit=5 --format='yaml(message.attributes,message.data)'
```

Check Cloud Logging for the delivery and failing store:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="desirelines-deletion-service"
(severity>=WARNING OR httpRequest.status>=400)
```

Leave messages with missing or conflicting ownership on the DLQ for prompt
owner review. Use the original body and captured binding as evidence. See the
[ownership contract](../guides/deauthorization-cleanup.md#consumer-behavior).

For valid bindings after a store failure, resolve the dependency and follow
[Redriving a DLQ](dlq-redrive.md). The bulk command stops when it encounters
missing or unsupported binding attributes. The consumer checks the body and
registry on delivery. Confirm cleanup across PostgreSQL, BigQuery and Firestore
after replay. See [Python readiness failures](python-readiness-failing.md) if
the service is unhealthy.
