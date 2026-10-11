#!/usr/bin/env bash
# Best-effort scheduler telemetry: never turn a pipeline success into a failure.
set +e
set +u
set +x
set +o pipefail

warn() {
  printf '::warning::pipeline_record_stage: %s\n' "$1"
}

if [ "$#" -lt 4 ]; then
  warn 'expected <universe> <run_date> <stage> <status> [detail]; not recorded.'
  exit 0
fi

for variable in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GITHUB_SERVER_URL GITHUB_REPOSITORY GITHUB_RUN_ID; do
  if [ -z "${!variable}" ]; then
    warn "missing $variable; not recorded."
    exit 0
  fi
done

RUN_URL="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
# Use a JSON encoder so details containing quotes/newlines remain valid JSON.
if ! PAYLOAD=$(python3 - "$1" "$2" "$3" "$4" "$RUN_URL" "${5:-}" 2>/dev/null <<'PY'
import json
import sys
universe, run_date, stage, status, run_url, detail = sys.argv[1:]
print(json.dumps({
    "p_universe": universe,
    "p_run_date": run_date,
    "p_stage": stage,
    "p_status": status,
    "p_github_run_url": run_url,
    "p_detail": detail or None,
}))
PY
); then
  warn 'could not encode RPC payload; not recorded.'
  exit 0
fi

for attempt in 1 2 3; do
  # Suppress response bodies and curl diagnostics: neither can expose secrets.
  if curl --fail --silent --output /dev/null --connect-timeout 3 --max-time 10 \
    -X POST "${SUPABASE_URL%/}/rest/v1/rpc/pipeline_record_stage" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' \
    --data "$PAYLOAD" 2>/dev/null; then
    exit 0
  fi
  if [ "$attempt" -lt 3 ]; then sleep 2; fi
done
warn 'RPC failed after 3 attempts; pipeline continues.'
exit 0
