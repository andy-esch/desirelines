# 4. Cut Cloud Run cold-start cost and simplify the three FastAPI lifespans

**Severity:** Medium-High — directly reduces p99 latency and recurring
infra cost.

## What's there today

- The three FastAPI apps (`bq_inserter_app.py`, `postgres_writer_app.py`,
  `deletion_service_app.py`) duplicate ~40 lines of lifespan setup each:
  config load, OTel meter creation, OTel tracer setup, shared shutdown.
- All imports happen at module top-level in every app (e.g.
  `bq_inserter_app.py:11–33`).
- **Three separate Cloud Run services from the same image.** Each pays its
  own cold-start tax and minimum-instance charges.
- `Dockerfile` is multi-stage with `python:3.14-slim` (good), non-root
  (good), but does not use a distroless base or strip pip from the runtime
  image.

## Recommendations

1. **Extract a `make_app(service_name, *, on_create, on_delete, ...)`
   factory** in `cloudrun/_app_factory.py` (or extend `webhook_handler.py`)
   that takes the per-service callbacks and wires lifespan, OTel setup,
   `/health`, and `POST /`. Each app file becomes ~20 lines. Reduces drift
   between services and shrinks the test surface.
2. **Move heavy imports inside the lifespan handler** where they can be
   deferred until first request (e.g. `google.cloud.bigquery`, `sqlalchemy`
   for non-PG services). Cloud Run cold starts are dominated by import
   time; lazy imports on rarely-used paths can shave 200–500 ms.
3. **Set `minInstances=1`** for the bq-inserter and postgres-writer if
   traffic is bursty but continuous; the cost (~$5–10/mo per service) is
   usually worth eliminating cold-start tail latency for webhook delivery.
4. **Use Cloud Run's `--cpu-boost` flag** at deploy time. It's free and
   gives 2x CPU during startup — measurable cold-start improvement on
   Python.
5. **Switch the runtime stage to a distroless base**
   (`gcr.io/distroless/python3-debian12:nonroot`) — removes shell, package
   manager, and unused libs. ~50% smaller image, faster Cloud Run image
   pulls, smaller attack surface.
6. **Consider collapsing to a single FastAPI app** with three routes
   (`/bq`, `/pg`, `/deauth`) deployed as one Cloud Run service with three
   Eventarc triggers pointing at different paths. You'd pay one
   cold-start cost, one min-instance, and have one place to fix bugs.
   The tradeoff is coupled deploys; given that all three services already
   share an image and are released together, the coupling cost is
   near-zero.

## References

- Cloud Run cold-start tips: <https://cloud.google.com/run/docs/tips/general>
- Cloud Run startup CPU boost:
  <https://cloud.google.com/run/docs/configuring/cpu#startup-boost>
- Distroless: <https://github.com/GoogleContainerTools/distroless>
- "4 tips supercharging your Python app on Cloud Run":
  <https://cloud.google.com/blog/topics/developers-practitioners/4-tips-supercharging-your-python-app-cloud-run>
