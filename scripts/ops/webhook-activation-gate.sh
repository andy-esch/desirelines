#!/usr/bin/env bash
#
# Telemetry activation gate for the Strava callback capability.
#
# Proves that a real capability sent to a deployed dispatcher is absent from
# every retained surface: application logs, Cloud Run request logs, Cloud Trace
# span names/attributes, and HTTP metric labels.
#
# Secret handling rules this script follows:
#   - the capability is never printed, never written to disk, never in argv
#   - it reaches curl through a stdin config file, and helpers through the
#     environment (owner-readable) rather than the command line (world-readable)
#   - every search reports a COUNT; a matching line is never displayed
#
# Usage: ./activation-gate.sh <dev|prod>
#
set -euo pipefail

ENV_NAME="${1:?usage: $0 <dev|prod>}"

# shellcheck source=/dev/null  # path is resolved at runtime, not lintable
source "$(dirname "${BASH_SOURCE[0]}")/_gcp_env.sh"

require_env_name "$ENV_NAME"
require_gcp_project "$ENV_NAME"

REGION="us-central1"
SERVICE="desirelines-dispatcher"

PASS=0
FAIL=0
ok() {
  printf '  \033[32m✓\033[0m %s\n' "$1"
  PASS=$((PASS + 1))
}
bad() {
  printf '  \033[31m✗\033[0m %s\n' "$1"
  FAIL=$((FAIL + 1))
}
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die() {
  bad "$1"
  printf '\n  GATE ABORTED\n'
  exit 1
}

# Count occurrences of $CAP (from the environment) in stdin. Keeps the secret
# out of grep's argv, which is world-readable via /proc on Linux.
count_secret() { python3 -c 'import os,sys; print(sys.stdin.read().count(os.environ["CAP"]))'; }

# curl's config grammar treats quotes, backslashes and newlines as syntax.
reject_unsafe() {
  local name="$1" value="$2"
  if [[ "$value" == *'"'* || "$value" == *\\* || "$value" == *$'\r'* || "$value" == *$'\n'* ]]; then
    die "$name contains characters unsafe for a curl config"
  fi
}

# ---------------------------------------------------------------------------
step "0. Preconditions"
# ---------------------------------------------------------------------------

SERVICE_JSON=$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --project="$GCP_PROJECT_ID" --format=json)

MODE=$(jq -er '.spec.template.spec.containers[0].env[]
               | select(.name == "WEBHOOK_ROUTE_MODE") | .value' <<<"$SERVICE_JSON")
if [ "$MODE" = "dual" ] || [ "$MODE" = "capability" ]; then
  ok "route mode is '$MODE'"
else
  die "route mode is '$MODE' — apply the dual-mode config before running the gate"
fi

READY=$(jq -er '.status.conditions[] | select(.type=="Ready") | .status' <<<"$SERVICE_JSON")
if [ "$READY" = "True" ]; then ok "latest revision is Ready"; else die "revision is not Ready"; fi

REVISION=$(jq -er '.status.latestReadyRevisionName' <<<"$SERVICE_JSON")
ok "revision under test: $REVISION"

BASE_URL=$(jq -er '.status.url' <<<"$SERVICE_JSON")
reject_unsafe "Cloud Run URL" "$BASE_URL"

# Read the capability at the exact version this revision mounts, never "latest".
PINNED_VERSION=$(jq -er '.spec.template.spec.volumes[]
                         | select(.secret.secretName == "INFISICAL_STRAVA_WEBHOOK_CALLBACK_CAPABILITY")
                         | .secret.items[] | select(.path == "value") | .key' <<<"$SERVICE_JSON") ||
  die "the deployed revision does not mount a callback capability"
if [[ "$PINNED_VERSION" =~ ^[1-9][0-9]*$ ]]; then
  ok "capability mounted from pinned secret version $PINNED_VERSION"
else
  die "capability is not pinned to a numeric secret version"
fi

CAP=$(gcloud secrets versions access "$PINNED_VERSION" \
  --secret=INFISICAL_STRAVA_WEBHOOK_CALLBACK_CAPABILITY --project="$GCP_PROJECT_ID")
export CAP
if [[ "$CAP" =~ ^[0-9a-f]{64}$ ]]; then
  ok "capability is canonical 64-char lowercase hex (value not shown)"
else
  die "capability is not canonical"
fi

VERIFY_TOKEN=$(gcloud secrets versions access latest \
  --secret=INFISICAL_STRAVA_WEBHOOK_VERIFY_TOKEN --project="$GCP_PROJECT_ID")
reject_unsafe "verify token" "$VERIFY_TOKEN"

EXCLUSIONS=$(curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://logging.googleapis.com/v2/projects/${GCP_PROJECT_ID}/exclusions")
if jq -e '.exclusions[]?
          | select(.name == "exclude-dispatcher-webhook-callback-capability")
          | select((.disabled // false) == false)' >/dev/null <<<"$EXCLUSIONS"; then
  ok "request-log exclusion present and enabled"
else
  bad "request-log exclusion missing or disabled"
fi

EXTRA_SINKS=$(gcloud logging sinks list --project="$GCP_PROJECT_ID" --format="value(name)" |
  { grep -cvE '^_(Default|Required)$' || true; })
if [ "$EXTRA_SINKS" -eq 0 ]; then
  ok "no user-defined log sinks — the project exclusion governs the only export"
else
  bad "$EXTRA_SINKS user-defined sink(s): the project exclusion does NOT govern these"
fi

MARK="gate$(date -u +%Y%m%d%H%M%S)"

# ---------------------------------------------------------------------------
step "1. Probes (capability reaches curl over stdin, never argv)"
# ---------------------------------------------------------------------------

probe() { # label expected_status path_and_query [json_body]
  local label="$1" want="$2" path="$3" body="${4:-}" status extra=""
  [ -n "$body" ] && extra=$'request = "POST"\nheader = "Content-Type: application/json"\ndata = "'"$body"$'"'
  status=$(
    curl --config - <<EOF
url = "${BASE_URL}${path}"
$extra
path-as-is
silent
output = /dev/null
write-out = "%{http_code}"
EOF
  )
  if [ "$status" = "$want" ]; then ok "$label → $status"; else bad "$label → $status (want $want)"; fi
}

probe "verification GET, valid capability" 200 \
  "/webhook/${CAP}?hub.mode=subscribe&hub.challenge=${MARK}&hub.verify_token=${VERIFY_TOKEN}"

probe "POST, valid capability + wrong subscription_id" 401 \
  "/webhook/${CAP}" \
  '{\"aspect_type\":\"create\",\"object_type\":\"activity\",\"object_id\":1,\"owner_id\":1,\"event_time\":1,\"subscription_id\":999999999}'

# Spellings that carry the real credential but must not route or be retained.
#
# These go through http.client, not curl: curl collapses a leading "//" into "/"
# even with --path-as-is and --request-target, so a curl-driven probe would
# silently test the canonical path and report a false pass. http.client writes
# the request target byte-for-byte. The capability reaches it through the
# environment, so it stays out of argv here too.
VARIANT_RESULTS=$(
  python3 - "$BASE_URL" <<'PY'
import http.client, os, sys, urllib.parse
cap = os.environ["CAP"]
host = urllib.parse.urlparse(sys.argv[1]).netloc
for target in (f"//webhook/{cap}", f"/WEBHOOK/{cap}", f"/./webhook/{cap}",
               f"/%77ebhook/{cap}", f"/webhook/{cap}%00", f"/webhook/{cap};x",
               f"/webhook/{cap}.json", f"/unrelated/{cap}"):
    conn = http.client.HTTPSConnection(host, timeout=20)
    try:
        conn.putrequest("GET", target, skip_accept_encoding=True)
        conn.endheaders()
        resp = conn.getresponse(); resp.read()
        print(f"{resp.status} {target.replace(cap, '<CAP>')}")
    finally:
        conn.close()
PY
)
# Any non-2xx is a pass. Some of these never reach the container at all: the
# Google Front End normalizes dot segments (302), and rejects "//" and encoded
# path prefixes (400), before Cloud Run invokes the revision. Demanding exactly
# 404 would fail on the platform being stricter than the application.
while read -r status target; do
  case "$status" in
    404) ok "non-canonical $target → 404 (application rejected)" ;;
    2*) bad "non-canonical $target → $status — REACHED THE HANDLER" ;;
    3* | 4* | 5*) ok "non-canonical $target → $status (rejected upstream of the handler)" ;;
    *) bad "non-canonical $target → $status (unexpected)" ;;
  esac
done <<<"$VARIANT_RESULTS"

# The plain route means different things in each mode, so assert the one that
# applies. This is what lets the same script serve both the dual pass and the
# capability pass.
if [ "$MODE" = "dual" ]; then
  probe "plain /webhook still verifies (existing callback undisturbed)" 200 \
    "/webhook?hub.mode=subscribe&hub.challenge=${MARK}&hub.verify_token=${VERIFY_TOKEN}"
else
  probe "plain GET /webhook is retired" 404 \
    "/webhook?hub.mode=subscribe&hub.challenge=${MARK}&hub.verify_token=${VERIFY_TOKEN}"
  probe "plain POST /webhook is retired" 404 "/webhook" \
    '{\"aspect_type\":\"create\",\"object_type\":\"activity\",\"object_id\":1,\"owner_id\":1,\"event_time\":1,\"subscription_id\":999999999}'
fi

echo "  waiting 90s for log and trace propagation..."
sleep 90

# ---------------------------------------------------------------------------
step "2. Retained-surface search (counts only, never content)"
# ---------------------------------------------------------------------------

search_logs() { # label log_filter
  local label="$1" filter="$2" n
  n=$(gcloud logging read "$filter" --project="$GCP_PROJECT_ID" \
    --freshness=20m --limit=2000 --format=json 2>/dev/null | count_secret)
  if [ "$n" -eq 0 ]; then ok "$label: 0 occurrences"; else bad "$label: $n occurrence(s) — CAPABILITY RETAINED"; fi
}

DISPATCHER='resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'"'

search_logs "application logs (stdout/stderr)" \
  "$DISPATCHER AND (log_id(\"run.googleapis.com/stdout\") OR log_id(\"run.googleapis.com/stderr\"))"
search_logs "Cloud Run request logs" \
  "$DISPATCHER AND log_id(\"run.googleapis.com/requests\")"
search_logs "every dispatcher log stream" \
  "$DISPATCHER"

# Positive control. If the redacted marker is also absent, the searches above
# proved nothing — they were reading the wrong logs or the wrong window.
# No log_id filter here on purpose: the dispatcher's slog handler writes to
# stderr, so a stdout-only search finds nothing and fails for the wrong reason.
REDACTED=$(gcloud logging read "$DISPATCHER" \
  --project="$GCP_PROJECT_ID" --freshness=20m --limit=2000 --format=json 2>/dev/null |
  grep -cF '/webhook/[redacted]' || true)
if [ "$REDACTED" -gt 0 ]; then
  ok "positive control: $REDACTED redacted '/webhook/[redacted]' line(s) present"
else
  bad "positive control FAILED — searches may be looking in the wrong place"
fi

# ---------------------------------------------------------------------------
step "3. Cloud Trace span names and attributes"
# ---------------------------------------------------------------------------

TRACE_HITS=$(
  python3 - "$GCP_PROJECT_ID" <<'PY'
import datetime, os, subprocess, sys, urllib.parse, urllib.request
project = sys.argv[1]; cap = os.environ["CAP"]
tok = subprocess.run(["gcloud","auth","print-access-token"],capture_output=True,text=True).stdout.strip()
end = datetime.datetime.now(datetime.timezone.utc); start = end - datetime.timedelta(minutes=25)
params = {"view":"COMPLETE","pageSize":"1000",
          "startTime":start.strftime('%Y-%m-%dT%H:%M:%SZ'),
          "endTime":end.strftime('%Y-%m-%dT%H:%M:%SZ')}
url = f"https://cloudtrace.googleapis.com/v1/projects/{project}/traces?" + urllib.parse.urlencode(params)
try:
    body = urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization":"Bearer "+tok})).read().decode()
except Exception:
    print(-1); sys.exit()
print(body.count(cap))
PY
)
if [ "$TRACE_HITS" = "-1" ]; then
  bad "Cloud Trace query failed — verify manually before proceeding"
elif [ "$TRACE_HITS" -eq 0 ]; then
  ok "Cloud Trace spans: 0 occurrences"
elif [ "${ACCEPT_PLATFORM_TRACE_RISK:-0}" = "1" ]; then
  # Cloud Run's frontend emits a parent span carrying the raw request URL. It is
  # upstream of the container, so no application change suppresses it, and Cloud
  # Logging exclusions do not apply to Cloud Trace. Accepted 2026-08-16 and
  # tracked separately; acknowledged here so the rest of the gate stays useful
  # rather than failing on a known, deliberate exception.
  printf '  \033[33m!\033[0m Cloud Trace spans: %d occurrence(s) — known platform-side retention, risk accepted\n' "$TRACE_HITS"
  printf '    tracked by: stop-cloud-run-platform-traces-retaining-webhook-callback-urls-and-verify-tokens\n'
  printf '    if this count grows beyond the platform parent span, investigate before proceeding\n'
else
  bad "Cloud Trace spans: $TRACE_HITS occurrence(s) — CAPABILITY RETAINED"
  bad "  set ACCEPT_PLATFORM_TRACE_RISK=1 only if these are the known platform parent spans"
fi

# ---------------------------------------------------------------------------
step "4. Metric label cardinality"
# ---------------------------------------------------------------------------

python3 - "$GCP_PROJECT_ID" <<'PY'
import datetime, json, os, subprocess, sys, urllib.parse, urllib.request
project = sys.argv[1]; cap = os.environ["CAP"]
tok = subprocess.run(["gcloud","auth","print-access-token"],capture_output=True,text=True).stdout.strip()
end = datetime.datetime.now(datetime.timezone.utc); start = end - datetime.timedelta(hours=1)
GREEN, RED, OFF = "\033[32m✓\033[0m", "\033[31m✗\033[0m", ""

def series(metric):
    p = {"filter": f'metric.type="workload.googleapis.com/desirelines.io/{metric}"',
         "interval.startTime": start.strftime('%Y-%m-%dT%H:%M:%SZ'),
         "interval.endTime": end.strftime('%Y-%m-%dT%H:%M:%SZ')}
    url = f"https://monitoring.googleapis.com/v3/projects/{project}/timeSeries?" + urllib.parse.urlencode(p)
    try:
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok})
        return json.load(urllib.request.urlopen(req)).get("timeSeries", [])
    except Exception:
        return []

ALLOWED = {"accepted", "rejected", "legacy"}
results = {s["metric"]["labels"].get("result") for s in series("webhook/callback_capability")} - {None}
if not results:
    print(f"  {RED} callback_capability has no data — probes never reached the counter")
elif results <= ALLOWED:
    print(f"  {GREEN} callback_capability result labels bounded: {sorted(results)}")
else:
    print(f"  {RED} callback_capability has unexpected labels: {sorted(results - ALLOWED)}")

routes = {s["metric"]["labels"].get("http_route") for s in series("http/request.duration")} - {None}
if any(cap in r for r in routes):
    print(f"  {RED} http_route label contains the capability")
else:
    hooks = sorted(r for r in routes if "webhook" in r)
    print(f"  {GREEN} http_route labels are templates: {hooks or '(no webhook route sampled yet)'}")
PY

# ---------------------------------------------------------------------------
step "Result"
# ---------------------------------------------------------------------------
printf '  %d passed, %d failed\n\n' "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "  GATE PASSED — this capability is safe to register with Strava."
else
  echo "  GATE FAILED — do not register this capability."
  echo "  Fix the leak, then rotate to a new capability version before retrying."
  exit 1
fi
