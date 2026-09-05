#!/usr/bin/env bash
#
# Runs the official MCP conformance suite (revision 2026-07-28) twice against
# examples/http/server.ts: once bare, once instrumented by mcp-opentelemetry.
# Fails when the two runs do not produce the same scenarios with the same
# per-check statuses.
#
#   ./scripts/conformance.sh
#
# Results land in test/integration/results/conformance/{bare,instrumented} and
# the table in test/integration/results/conformance/comparison.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}/mcp"
SUITE="@modelcontextprotocol/conformance@0.2.0-alpha.11"
REQUIREMENTS="2026-07-28"
OUT="test/integration/results/conformance"

rm -rf "$OUT/bare" "$OUT/instrumented"
mkdir -p "$OUT/bare" "$OUT/instrumented"

SERVER_PID=""

stop_server() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    # `npx tsx` may leave the actual node process behind when npx forks.
    pkill -f 'tsx examples/http/server.ts' 2>/dev/null || true
    SERVER_PID=""
}
trap stop_server EXIT

# start_server <stderr file>  -- environment is inherited from the caller
start_server() {
    local log="$1"
    : >"$log"
    npx tsx examples/http/server.ts >/dev/null 2>"$log" &
    SERVER_PID=$!
    local waited=0
    while ! grep -q "listening on ${URL}" "$log" 2>/dev/null; do
        if ! kill -0 "$SERVER_PID" 2>/dev/null; then
            echo "server died before it was ready:" >&2
            cat "$log" >&2
            exit 1
        fi
        if [ "$waited" -ge 300 ]; then
            echo "server did not become ready within 30s" >&2
            cat "$log" >&2
            exit 1
        fi
        waited=$((waited + 1))
        sleep 0.1
    done
}

run_suite() {
    local dir="$1"
    # The suite exits non-zero when a required scenario fails. That verdict is
    # reported, not enforced here: what this script enforces is that both runs
    # agree.
    set +e
    npx -y "$SUITE" server --url "$URL" --requirements "$REQUIREMENTS" --output-dir "$dir" 2>&1 | tee "$dir/run.txt"
    local rc=${PIPESTATUS[0]}
    set -e
    echo "$rc" >"$dir/exit-code.txt"
}

echo "=== run 1/2: bare server ==="
start_server "$OUT/bare/server-stderr.txt"
run_suite "$OUT/bare"
stop_server

echo
echo "=== run 2/2: instrumented server ==="
INSTRUMENTED_RAW="$OUT/instrumented/server-stderr.raw.txt"
MCP_OTEL_INSTRUMENT=1 MCP_OTEL_NO_OTLP=1 MCP_OTEL_STDERR_SPANS=1 start_server "$INSTRUMENTED_RAW"
run_suite "$OUT/instrumented"
stop_server

# The instrumented server writes its readiness banner and any handler errors on
# the same stream as the span JSON lines; keep only the spans in the .jsonl.
grep '^{' "$INSTRUMENTED_RAW" >"$OUT/instrumented/server-stderr.jsonl" || true
grep -v '^{' "$INSTRUMENTED_RAW" >"$OUT/instrumented/server-stderr.txt" || true
rm -f "$INSTRUMENTED_RAW"
echo "spans captured: $(wc -l <"$OUT/instrumented/server-stderr.jsonl" | tr -d ' ')"

echo
echo "=== comparison ==="
node scripts/conformance-compare.mjs "$OUT/bare" "$OUT/instrumented" "$OUT/comparison.md"
echo "wrote $OUT/comparison.md"

# The suite's own check descriptions use em and en dashes, which this repository
# bans everywhere (scripts/lint-typography.mjs walks test/). Normalise the stored
# artefacts to a plain hyphen; nothing else about them is touched.
find "$OUT" -type f \( -name '*.json' -o -name '*.md' -o -name '*.log' -o -name '*.tsv' -o -name '*.txt' -o -name '*.jsonl' \) \
    -exec perl -CSD -i -pe 's/[\x{2013}\x{2014}]/-/g' {} +
