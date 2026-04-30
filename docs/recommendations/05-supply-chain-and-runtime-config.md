# 5. Tighten supply chain and runtime config

**Severity:** Medium — but cheap and removes a class of bugs.

## What's there today

- **Two lockfiles**: `uv.lock` and `stravapipe.lock` (385 KB and 319 KB
  respectively). The audit couldn't determine why both exist. This is a
  footgun: one will drift.
- **Redundant deps**: `psycopg>=3.2.0` and `psycopg-binary>=3.2.0`
  (`pyproject.toml:25–26`). For containerized GCP workloads,
  `psycopg-binary` alone is correct — the pure-`psycopg` distribution
  requires `libpq-dev` at the system level. The redundancy expands the
  install surface and slows builds.
- **Floor-only pinning** (`>=` only). Fine when a lockfile is canonical,
  but with two lockfiles in conflict it isn't.
- **No webhook signature verification.** The webhook handler doesn't
  verify a Strava HMAC — but the dispatcher (a separate service) handles
  the original webhook, so this service receives Pub/Sub messages from a
  trusted internal source. The real concern is **OIDC verification** of
  the Pub/Sub push request: by default any caller could POST to `/` if
  the Cloud Run service is publicly reachable.
- **`opentelemetry-exporter-gcp-monitoring>=1.8.0a0`** — pinned to a
  pre-release. Acceptable, but worth tracking.

## Recommendations

1. **Resolve the dual lockfile.** Pick one (`uv.lock` is the standard `uv`
   artifact; `stravapipe.lock` is likely a Pants-specific resolve). If
   Pants needs a separate one, document why in `pyproject.toml` or
   `BUILD`. If not, delete `stravapipe.lock`.
2. **Drop `psycopg` from deps**, keep `psycopg-binary`. (Or, for
   production, switch to building `psycopg` from source against a bundled
   `libpq` for slightly better performance — but binary is the right
   default.)
3. **Verify Pub/Sub push OIDC tokens at the FastAPI layer.** Each `/`
   endpoint should validate the `Authorization: Bearer <id_token>` header
   against your service's expected audience. Use
   `google.auth.transport.requests` to validate. This belongs in a
   FastAPI dependency, ideally as part of the shared app factory from
   recommendation #4. Without it, a leaked Cloud Run URL becomes a write
   endpoint to your BQ and Postgres.
4. **Add Dependabot or Renovate** for `pyproject.toml` and the
   `Dockerfile`. The Renovate config can be very minimal — just track
   GCP, FastAPI, OTel, and protobuf majors.
5. **Run `pip-audit` in CI** (or `uv pip audit` once available) on every
   PR. Cheap, fast, catches `requests`/`urllib3` CVEs early.
6. **Minor: add `interrogate` or `ruff D` (pydocstyle)** to the lint set —
   docstrings in the package are notably good already (well above
   average), so enforcing the standard is low-cost.
7. **Pydantic-settings hygiene.** `config/common.py` and the per-service
   configs are clean but worth confirming each one explicitly forbids
   extra fields (`model_config = SettingsConfigDict(extra="forbid")`) so
   that an env-var typo (`POSTGRES_POOL_STRATGY=internal`) fails at
   startup rather than silently using the default.

## References

- Pub/Sub push authentication:
  <https://cloud.google.com/pubsub/docs/authentication>
- pip-audit: <https://github.com/pypa/pip-audit>
- Renovate Python preset: <https://docs.renovatebot.com/python/>
- Pydantic-settings strictness:
  <https://docs.pydantic.dev/latest/concepts/pydantic_settings/>
- interrogate: <https://interrogate.readthedocs.io/>
