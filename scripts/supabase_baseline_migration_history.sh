#!/usr/bin/env bash
# One-time: record every migration that was already applied by hand (SQL
# editor) in the remote project's migration history, so `supabase db push`
# only runs migrations added after the switch to supabase/migrations/.
#
# Usage (after `supabase link --project-ref <ref>`):
#   scripts/supabase_baseline_migration_history.sh            # default cutoff
#   scripts/supabase_baseline_migration_history.sh 20260921235436
#
# Versions <= the cutoff are marked applied; later files are left for
# `supabase db push`. Re-running is harmless.
set -euo pipefail

CUTOFF="${1:-20260921235436}"
cd "$(dirname "$0")/.."

versions=()
for f in supabase/migrations/*.sql; do
  v="$(basename "$f" | cut -d_ -f1)"
  if [[ "$v" < "$CUTOFF" || "$v" == "$CUTOFF" ]]; then
    versions+=("$v")
  fi
done

if [[ ${#versions[@]} -eq 0 ]]; then
  echo "No migrations at or before ${CUTOFF}." >&2
  exit 1
fi

echo "Marking ${#versions[@]} migrations (<= ${CUTOFF}) as applied..."
supabase migration repair --status applied "${versions[@]}"
echo "Done. Pending migrations:"
supabase migration list
