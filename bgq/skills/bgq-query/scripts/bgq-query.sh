#!/usr/bin/env bash
# bgq-query helper: generate YAML, run query, output path
# Usage: bgq-query.sh <yaml_string> [output_format] [output_path]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Find bgq root: walk up from script location
BGQ_ROOT=""
for dir in "$SCRIPT_DIR" "$SCRIPT_DIR/.." "$SCRIPT_DIR/../.." "$HOME/workspace/bangumi-wiki-tools/bgq"; do
  if [ -f "$dir/bin/bgq" ]; then
    BGQ_ROOT="$dir"
    break
  fi
done

if [ -z "$BGQ_ROOT" ]; then
  echo "ERROR: bgq binary not found. Set BGQ_ROOT or place bin/bgq in bgq/" >&2
  exit 1
fi

BGQ="$BGQ_ROOT/bin/bgq"
YAML_INPUT="$1"
FORMAT="${2:-csv}"
OUTPUT="${3:-}"

# Write YAML to temp file
TMPFILE=$(mktemp /tmp/bgq-query-XXXXXX.yaml)
echo "$YAML_INPUT" > "$TMPFILE"
trap "rm -f $TMPFILE" EXIT

# Build command
CMD=("$BGQ" query --config "$TMPFILE" --format "$FORMAT")
if [ -n "$OUTPUT" ]; then
  CMD+=(--output "$OUTPUT")
fi

"${CMD[@]}"
