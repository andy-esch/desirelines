#!/usr/bin/env bash

# Replay dead-lettered messages back onto the topic they came from.
# Dry run by default; --execute is destructive (acks messages out of the DLQ).
#
# Procedure and caveats: docs/runbooks/dlq-redrive.md

set -euo pipefail

# shellcheck source=/dev/null  # path is resolved at runtime, not lintable
source "$(dirname "${BASH_SOURCE[0]}")/_gcp_env.sh"

usage() {
  echo "Usage: just dlq-replay <service> <environment> [--execute]"
  echo "Services: postgres-writer, deletion-service, activity-rows"
  echo "Example: just dlq-replay postgres-writer prod --execute"
}

if [ $# -lt 2 ]; then
  echo "❌ Error: Please specify service and environment"
  usage
  exit 1
fi

SERVICE="$1"
ENV_NAME="$2"
FLAG="${3:-}"

require_env_name "$ENV_NAME"

DRY_RUN=true
case "$FLAG" in
  "") ;;
  --execute) DRY_RUN=false ;;
  *)
    echo "❌ Error: Third argument must be --execute (or omitted for a dry run)"
    usage
    exit 1
    ;;
esac

# A redrive publishes back to the topic the original subscription reads, NOT to
# the DLQ topic. The names are irregular by design — the first two are declared
# in terraform/modules/desirelines/main.tf (underscores, no env suffix), the
# third in bigquery_subscription.tf (hyphens, env-suffixed) — so they are
# spelled out rather than derived.
case "$SERVICE" in
  postgres-writer) SOURCE_TOPIC="desirelines_activity_events" ;;
  deletion-service) SOURCE_TOPIC="desirelines_deauth_events" ;;
  activity-rows) SOURCE_TOPIC="desirelines-activity-rows-${ENV_NAME}" ;;
  *)
    echo "❌ Error: Unknown service '$SERVICE'"
    usage
    exit 1
    ;;
esac

DLQ_SUBSCRIPTION="desirelines-${SERVICE}-dlq-monitoring-${ENV_NAME}"

require_gcp_project "$ENV_NAME"

if [ "$DRY_RUN" = true ]; then
  MODE="DRY RUN"
else
  MODE="REPLAY"
fi

echo "🔁 DLQ replay — $MODE"
echo "   DLQ:          $DLQ_SUBSCRIPTION"
echo "   Replays onto: $SOURCE_TOPIC"

if [ "$DRY_RUN" = false ]; then
  confirm_destructive "$ENV_NAME" \
    "Replaying $DLQ_SUBSCRIPTION onto $SOURCE_TOPIC in $GCP_PROJECT_ID." \
    "   Messages are acked out of the DLQ once republished — this cannot be undone.
   Every subscription on $SOURCE_TOPIC will receive them, not just $SERVICE.
   Replaying into a still-broken service just refills the DLQ."
fi
echo ""

# Attributes that must not ride along on the replay:
#   CloudPubSubDeadLetter*         Pub/Sub stamps these on dead-lettering; they
#                                  describe the failure, not the event.
#   dispatcher_received_at_unix_ms The writer measures end-to-end freshness from
#                                  this stamp (SLO 3). Replaying a days-old
#                                  value would record that age as pipeline
#                                  latency. Dropping it makes the handler log
#                                  the skip instead, which is the honest reading
#                                  — a replay is not a live delivery.
# correlation_id and traceparent are kept so the replay ties back to the
# original failure in logs and traces.
readonly ATTRIBUTE_FILTER='
  .message.attributes // {}
  | with_entries(
      select(
        (.key | startswith("CloudPubSubDeadLetter") | not)
        and .key != "dispatcher_received_at_unix_ms"
      )
    )
  | . + {"replayed_from_dlq": "true"}
  | to_entries
  | map("\(.key)=\(.value)")
  | join(",")
'

# One jq pass per batch emitting TSV, rather than re-parsing the whole batch
# per message. Payload stays base64 in the field — it contains newlines and
# would otherwise break the record framing.
readonly BATCH_FILTER="
  .[]
  | [
      .ackId,
      .message.data,
      ($ATTRIBUTE_FILTER),
      (
        (.message.data | @base64d | fromjson? // null)
        | if . then
            [.aspect_type // \"?\", .object_type // \"?\",
             (.object_id // \"?\" | tostring),
             \"event_time=\" + ((.event_time // 0) | tostring)]
            | join(\" \")
          else \"(unparseable payload)\" end
      )
    ]
  | @tsv
"

replayed=0
inspected=0
failed=0
leases=()

# --ack-ids takes a list, so these go one call per batch rather than one per
# message. gcloud's startup cost dominates, which is the difference between a
# second and a minute on a large DLQ.
# Bash 3.2 (what macOS ships) has no namerefs, so callers expand the array.
join_by_comma() {
  local IFS=,
  echo "$*"
}

ack_batch() {
  gcloud pubsub subscriptions ack "$DLQ_SUBSCRIPTION" \
    --ack-ids="$(join_by_comma "$@")" >/dev/null
}

release_batch() {
  gcloud pubsub subscriptions modify-message-ack-deadline "$DLQ_SUBSCRIPTION" \
    --ack-ids="$(join_by_comma "$@")" --ack-deadline=0 >/dev/null
}

while true; do
  if ! BATCH=$(gcloud pubsub subscriptions pull "$DLQ_SUBSCRIPTION" \
    --limit=50 --format=json); then
    echo "❌ Error: could not pull from $DLQ_SUBSCRIPTION"
    exit 1
  fi

  if [ "$(printf '%s' "${BATCH:-[]}" | jq 'length')" -eq 0 ]; then
    break
  fi

  batch_acks=()
  # Process substitution, not a pipe: the counters must stay in this shell.
  while IFS=$'\t' read -r ack_id data_b64 attributes summary; do
    inspected=$((inspected + 1))

    if [ "$DRY_RUN" = true ]; then
      echo "   would replay: $summary"
      leases+=("$ack_id")
      continue
    fi

    # Publish first, ack second. An ack before a confirmed publish drops the
    # message permanently; a publish before a failed ack redelivers it, which
    # the idempotent handlers absorb.
    if gcloud pubsub topics publish "$SOURCE_TOPIC" \
      --message="$(printf '%s' "$data_b64" | base64 --decode)" \
      --attribute="$attributes" >/dev/null; then
      echo "   ✅ replayed: $summary"
      batch_acks+=("$ack_id")
      replayed=$((replayed + 1))
    else
      echo "   ❌ publish failed, leaving in DLQ: $summary"
      failed=$((failed + 1))
    fi
  done < <(printf '%s' "$BATCH" | jq -r "$BATCH_FILTER")

  if [ ${#batch_acks[@]} -gt 0 ]; then
    ack_batch "${batch_acks[@]}"
  fi
done

# Pulling leases messages for the subscription's ack deadline (10 min here),
# during which they are invisible to the next pull — including a follow-up
# --execute run. Holding them is what lets the loop above drain the DLQ instead
# of re-reading one batch; hand them all back now so a dry run costs nothing.
if [ ${#leases[@]} -gt 0 ]; then
  release_batch "${leases[@]}"
fi

echo ""
if [ "$DRY_RUN" = true ]; then
  echo "🔍 $inspected message(s) in the DLQ, none replayed."
  echo "   Re-run with --execute to replay them."
else
  echo "✅ Replayed $replayed of $inspected message(s) onto $SOURCE_TOPIC"
  if [ "$failed" -gt 0 ]; then
    echo "   ⚠️  $failed left in the DLQ (publish failed)"
  fi
  echo "   Watch them land:"
  echo "   gcloud logging read 'resource.labels.service_name=\"desirelines-${SERVICE}\"' --limit=20 --freshness=10m"
fi
