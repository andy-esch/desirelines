# 2. Migrate BigQuery writes to the Storage Write API

**Severity:** High — significant cost, latency, and correctness improvement.

## What's there today

`adapters/gcp/_bigquery.py:140` uses `insert_rows_json` (the legacy
`tabledata.insertAll` streaming endpoint), then a follow-up `MERGE` from a
`*_staging` table. The cleanup at `_bigquery.py:184` even has to handle the
90-minute streaming buffer window (lines 199–207) where rows are visible to
MERGE but not deletable — that is a direct symptom of the legacy API.

## Why this is suboptimal

- **Cost.** Legacy streaming is $0.010/200 MB ($0.05/GB). The Storage Write
  API in committed mode is **half the price** ($0.025/GB), and pending mode
  within the monthly free 2 TiB tier costs $0.
- **Latency to queryability.** The streaming buffer means rows can be
  MERGE-targeted but not DELETE-targeted for up to 90 minutes (you've
  already coded around this at `_bigquery.py:199`). Storage Write commits
  are immediately consistent.
- **Exactly-once.** The Storage Write API supports exactly-once semantics
  via stream offsets — giving you a replacement for the staging+MERGE
  idempotency dance, at least for inserts.
- **Quotas.** Storage Write has much higher per-project quotas (10 GB/s per
  region default) than streaming inserts.

## Recommendations

- **Tactical, low-risk first step:** keep the staging+MERGE pattern but
  switch `_write_to_staging` / `_write_batch_to_staging` to use
  `google-cloud-bigquery-storage`'s `BigQueryWriteClient` in default
  (committed) mode against the staging table. This alone halves ingestion
  cost and removes the 90-minute streaming-buffer special case at
  `_bigquery.py:199–207`.
- **Strategic:** for non-mutable inserts (the deletion-archive table
  `deleted_activities`, and SummaryActivity backfill rows that you never
  expect to update), use Storage Write API directly to the destination
  table in **pending** mode and commit the stream — no staging table needed.
- For the backfill batches in `application/backfill/service.py:261–297`
  (BATCH_SIZE up to 10k), Storage Write is dramatically faster than
  `insert_rows_json` because it's gRPC-streamed.

## References

- Storage Write API overview: <https://cloud.google.com/bigquery/docs/write-api>
- Python client samples:
  <https://cloud.google.com/bigquery/docs/write-api-streaming>
- BigQuery streaming pricing:
  <https://cloud.google.com/bigquery/pricing#data_ingestion_pricing>
- "Choose a data ingestion method" — recommends Storage Write for new code:
  <https://cloud.google.com/bigquery/docs/loading-data>

The legacy `insertAll` is officially in maintenance mode for new
development.
