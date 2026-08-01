# Architecture

## Documents

- **[Domain Model](domain-model.md)** - Cross-package type glossary mapping core concepts (Activity, Webhook Event, Metrics, etc.) to their type names in each package. Start here when tracing data through the pipeline.
- **[Authentication](authentication.md)** - OAuth2 flow and Firebase auth architecture
- **[Observability](observability.md)** - Tracing, logging, and metrics topology across Go and Python services. Cross-language trace propagation, sampling, span conventions.
- **[Pub/Sub Subscription Design](pubsub-subscription-design.md)** - Webhook event delivery via Google Cloud Pub/Sub
- **[PostgreSQL ↔ BigQuery Consistency](postgres-bigquery-consistency.md)** - The archival-mirror contract: PostgreSQL is the source of truth, BigQuery may lag/diverge, and how (and how not) the stores reconcile.
- **[BigQuery Write Architecture](bigquery-write-architecture.md)** - Moving the BigQuery write off application code onto a Pub/Sub BigQuery subscription in CDC mode (log/live tables, no writer service).
- **[Sitemap](sitemap.md)** - Frontend route structure
