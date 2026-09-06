#!/usr/bin/env bash
# measure-ecosystem.sh: reproduces the ecosystem matrix of the README, a
# conformance measurement of the OpenTelemetry instrumentations for MCP.
# First run on 2026-09-06.
#
# Usage: bash scripts/measure-ecosystem.sh [work_dir]
# Default work dir: ./ecosystem-measure. Nothing in any repository is touched:
# every package is downloaded. Requires gh, npm, node, python3, unzip.

set -uo pipefail
WORK="${1:-$PWD/ecosystem-measure}"
PKGS="$WORK/pkgs"; PY="$PKGS/py"
mkdir -p "$PKGS" "$PY" "$WORK/ref"

NPM_PKGS=(
  "@arizeai/openinference-instrumentation-mcp" "@traceloop/instrumentation-mcp"
  "@shinzolabs/instrumentation-mcp" "mcp-otel" "mcp-trace"
  "@monocle.sh/instrumentation-mcp" "@theharithsa/opentelemetry-instrumentation-mcp"
  "@modelcontextprotocol/core" "@modelcontextprotocol/client" "@modelcontextprotocol/server"
)
# Candidates seen by the npm search and set aside; downloaded to justify the exclusion.
NPM_ECARTES=(
  "mcp-telemetry-sdk" "@listo-ai/mcp-observability"
  "@nestm/mcp-observability" "@stipend-mcp/observability"
)
PYPI_PKGS=(mcp mcp-types openinference-instrumentation-mcp opentelemetry-instrumentation-mcp logfire)

# ----------------------------------------------------------- 0. the reference
echo "### 0. OpenTelemetry semantic conventions for MCP"
[ -d "$WORK/ref/semconv-genai" ] || gh repo clone open-telemetry/semantic-conventions-genai "$WORK/ref/semconv-genai" -- --depth 1
REF="$WORK/ref/semconv-genai/docs/gen-ai/mcp.md"
git -C "$WORK/ref/semconv-genai" log -1 --format='revision %H du %ad'
grep -c '' "$REF" | sed 's/^/lignes : /'
echo "-- propagation rule (l.52-66), parenting (l.102-106), name and kind (l.143-152, l.369-378) --"
sed -n '52,66p;102,106p;143,152p;369,378p' "$REF"
echo "-- attributes named by the document --"
grep -ohE '\[`(mcp|gen_ai|jsonrpc|rpc|error|network|server|client)\.[a-z._]+`\]' "$REF" | sort -u
echo "-- the four metrics --"
grep -oE '^### Metric: `mcp\.[a-z.]+`' "$REF"

# ------------------------------------------------- 1. candidate search
echo; echo "### 1. npm search (4 queries) and MCP candidate triage"
for q in "instrumentation-mcp" "mcp%20opentelemetry" "mcp%20otel" "modelcontextprotocol%20instrumentation" "mcp%20tracing" "mcp%20observability" "mcp%20telemetry"; do
  echo "== $q"
  curl -s "https://registry.npmjs.org/-/v1/search?text=$q&size=40" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{JSON.parse(d).objects.forEach(o=>{const p=o.package;
      if(/mcp|modelcontext/i.test(p.name)&&/instrument|otel|telemetr|observab|trace/i.test(p.name+" "+(p.description||"")))
        console.log(" ",p.name,p.version,(p.date||"").slice(0,10))})})'
done

# ----------------------------- 2. metadata: version, date, 90-day cadence
echo; echo "### 2. Versions, ISO dates, licenses, 90-day cadence"
cat > "$WORK/npm_meta.js" <<'EOF'
const {execSync}=require('child_process');
for(const p of process.argv.slice(2)){
  let j; try{ j=JSON.parse(execSync(`npm view ${p} time license repository.url --json 2>/dev/null`,{maxBuffer:1e8})); }
  catch(e){ console.log(`${p} | INTROUVABLE`); continue; }
  const cut=Date.now()-90*864e5;
  const vs=Object.entries(j.time).filter(([k])=>!['created','modified'].includes(k))
            .sort((a,b)=>new Date(a[1])-new Date(b[1]));
  const last=vs[vs.length-1];
  console.log(`${p} | v${last[0]} | ${last[1].slice(0,10)} | ${vs.filter(([,v])=>new Date(v)>cut).length} rel/90j | ${vs.length} total | ${j.license} | ${j['repository.url']}`);
}
EOF
node "$WORK/npm_meta.js" "${NPM_PKGS[@]}" "${NPM_ECARTES[@]}"

cat > "$WORK/pypi_meta.py" <<'EOF'
import sys, json, datetime, urllib.request
cut = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=90)
for p in sys.argv[1:]:
    d = json.load(urllib.request.urlopen("https://pypi.org/pypi/%s/json" % p))
    info, rel = d["info"], d["releases"]
    items = sorted((max(f["upload_time_iso_8601"] for f in fs), v) for v, fs in rel.items() if fs)
    cur = [i for i in items if i[1] == info["version"]]
    recent = [i for i in items if datetime.datetime.fromisoformat(i[0].replace("Z", "+00:00")) > cut]
    u = info.get("project_urls") or {}
    print("%-40s | v%s | %s | %d rel/90j | %d total | %s | %s" % (
        p, info["version"], (cur[0][0][:10] if cur else "?"), len(recent), len(items),
        info.get("license_expression") or (info.get("license") or "")[:30],
        u.get("Source") or u.get("Repository") or u.get("Homepage")))
EOF
python3 "$WORK/pypi_meta.py" "${PYPI_PKGS[@]}"

# ------------------------------------------------ 3. download, extraction
echo; echo "### 3. Download and extraction"
cd "$PKGS" || exit 1
for p in "${NPM_PKGS[@]}" "${NPM_ECARTES[@]}"; do npm pack "$p@latest" --silent >/dev/null 2>&1; done
for f in *.tgz; do d="x-${f%.tgz}"; mkdir -p "$d" && tar xzf "$f" -C "$d"; done
cd "$PY" || exit 1
# mcp 2.0.1 is a backport published AFTER 2.1.1: pin the current version.
python3 -m pip download mcp==2.1.1 mcp-types==2.1.1 openinference-instrumentation-mcp \
  opentelemetry-instrumentation-mcp logfire --no-deps -d . -q
for f in *.whl; do d="x-$(echo "$f" | cut -d- -f1,2)"; mkdir -p "$d" && (cd "$d" && unzip -oq "../$f"); done
ls -d "$PKGS"/x-* "$PY"/x-*

SRC=("$PKGS"/x-*/package/src "$PKGS"/x-*/package/dist "$PY"/x-*)
INC=(--include='*.ts' --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.py')

# The TypeScript SDK and mcp_types define the protocol vocabulary: their
# bundles would drown the code greps. They get their own section, 12.
# The Python SDK `mcp` stays in the greps: its instrumentation is built in.
NOSDK='x-modelcontextprotocol-|x-mcp_types-'

# --------------------------- 4. columns 2 and 3: propagation through params._meta
echo; echo "### 4. Outbound and inbound propagation (params._meta)"
grep -rn "params\._meta\|\"_meta\"\|'_meta'\|traceparent\|tracestate\|BAGGAGE_META_KEY\|propagation\.inject\|propagation\.extract\|propagate\.extract\|propagate\.inject\|get_global_textmap\|inject_trace_context\|extract_trace_context\|_attach_context_to_request" \
  "${SRC[@]}" "${INC[@]}" 2>/dev/null | grep -vE '\.map|\.d\.ts|dist-info|/tests?/|\.test\.' | grep -vE "$NOSDK"

# ---------------------------------- 5. column 4: spans, kind, exact name
echo; echo "### 5. Spans: creation, kind, name (string or template)"
grep -rn "startSpan\|startActiveSpan\|start_as_current_span\|start_span\|SpanKind\.\|logfire_instance\.span\|span_name\s*=\|spanName(" \
  "${SRC[@]}" "${INC[@]}" 2>/dev/null | grep -vE '\.map|\.d\.ts|dist-info|/tests?/|\.test\.' | grep -vE "$NOSDK"

# ----------------------------------------- 6. column 5: attribute keys
echo; echo "### 6. Attribute keys, per package"
for d in "$PKGS"/x-* "$PY"/x-*; do
  echo "## $(basename "$d")"
  grep -rhoE "['\"](mcp|gen_ai|jsonrpc|rpc|error|network|server|client|traceloop)\.[a-z_.]+['\"]" \
    "$d" "${INC[@]}" 2>/dev/null | tr -d "'\"" | sort -u | sed 's/^/  /'
  grep -rhoE "(setAttribute|setAttributes|set_attribute|set_attributes)\([^,)]{0,60}" "$d" 2>/dev/null \
    | grep -v '\.map' | sort -u | head -20 | sed 's/^/  ~ /'
done

# ------------------------------------- 7. column 6: parenting and links
echo; echo "### 7. Parenting: explicit parent context, links to the ambient context"
grep -rn "links\s*[:=]\|addLink\|context\.with(\|context\.attach\|attach_context\|ROOT_CONTEXT\|parentContext\|parent =" \
  "${SRC[@]}" "${INC[@]}" 2>/dev/null | grep -vE '\.map|\.d\.ts|dist-info|/tests?/|\.test\.' | grep -vE "$NOSDK" | head -40

# -------------------------- 8. column 7: notifications (progress, cancelled)
echo; echo "### 8. Instrumented notifications"
grep -rn "isJSONRPCNotification\|isJsonRpcNotification\|JSONRPCNotification(\|def notify(\|send_notification\|_received_notification\|_on_notify\|_isJSONRPCRequest\|isRequest(" \
  "${SRC[@]}" "${INC[@]}" 2>/dev/null | grep -vE '\.map|\.d\.ts|dist-info|/tests?/|\.test\.' | grep -vE "$NOSDK"

# --------------------------------------------- 9. column 8: metrics
echo; echo "### 9. Metrics: instrument created, name"
for d in "$PKGS"/x-* "$PY"/x-*; do
  h=$(grep -rn "getMeter\|createHistogram\|createCounter\|get_meter(\|create_histogram(\|create_counter(" "$d" 2>/dev/null \
      | grep -vE '\.map|\.d\.ts|dist-info|\.test\.|/tests?/|\.md:|/_internal/(metrics|config|main)\.py|integrations/')
  [ -n "$h" ] && { echo "## $(basename "$d")"; echo "$h" | sed 's/^/  /' | head -8; }
done
echo "-- convention metric names found in the code --"
grep -rn "mcp\.client\.operation\.duration\|mcp\.server\.operation\.duration\|mcp\.client\.session\.duration\|mcp\.server\.session\.duration" \
  "$PKGS"/x-* "$PY"/x-* 2>/dev/null | grep -vE '\.map|dist-info'
echo "(a package absent from the first list emits no metric)"

# ------------------------------------ 10. column 9: content capture
echo; echo "### 10. Content capture and its default"
for d in "$PKGS"/x-* "$PY"/x-*; do
  h=$(grep -rn "captureArguments\|captureResults\|recordInputs\|recordOutputs\|traceContent\|enableArgumentCollection\|TRACELOOP_TRACE_CONTENT\|logFields\|_should_send_prompts\|_shouldSendPrompts\|propagate_otel_context\|ENTITY_INPUT\|ENTITY_OUTPUT\|tool\.call\.arguments\|tool\.call\.result" "$d" 2>/dev/null \
      | grep -vE '\.map|\.d\.ts|dist-info')
  [ -n "$h" ] && { echo "## $(basename "$d")"; echo "$h" | sed 's/^/  /' | head -10; }
done

# ---------------------------------------------- 11. column 1: targets
echo; echo "### 11. Targets: declared version ranges"
for d in "$PKGS"/x-*; do
  [ -f "$d/package/package.json" ] || continue
  echo "## $(basename "$d")"
  python3 -c "import json,sys;p=json.load(open(sys.argv[1]));print('  peer:',p.get('peerDependencies',{}));print('  deps:',p.get('dependencies',{}))" "$d/package/package.json"
  grep -rhoE "InstrumentationNodeModuleDefinition\(\s*[\"'][^\"']+[\"'],\s*\[[^]]*\]" "$d/package" 2>/dev/null \
    | grep -v '\.map' | sort -u | sed 's/^/  /' | head
done
for d in "$PY"/x-*; do
  echo "## $(basename "$d")"
  grep -rhn "_instruments\s*=" "$d" --include='*.py' 2>/dev/null | sed 's/^/  /' | head -3
  grep -h "^Requires-Dist: mcp" "$d"/*.dist-info/METADATA 2>/dev/null | sed 's/^/  /' | head -3
done

# ------------------------------- 12. official SDKs: built-in instrumentation
echo; echo "### 12. Official SDKs"
echo "-- TS SDK 2.0.0: _meta constants, and nothing else --"
grep -rn "TRACEPARENT_META_KEY = \|TRACESTATE_META_KEY = \|BAGGAGE_META_KEY = \|LATEST_PROTOCOL_VERSION = " \
  "$PKGS"/x-modelcontextprotocol-core-*/package/dist/*.cjs 2>/dev/null
echo "(OTel occurrences in the three TS SDK packages:)"
grep -rc "opentelemetry" "$PKGS"/x-modelcontextprotocol-*/package/dist 2>/dev/null | grep -v ':0' || echo "  none"
echo "-- Python SDK mcp: built-in instrumentation --"
sed -n '1,60p' "$PY"/x-mcp-*/mcp/server/_otel.py 2>/dev/null
grep -n "OpenTelemetryMiddleware" "$PY"/x-mcp-*/mcp/server/lowlevel/server.py 2>/dev/null
grep -n "otel_span\|inject_trace_context" "$PY"/x-mcp-*/mcp/shared/jsonrpc_dispatcher.py 2>/dev/null
grep -A8 "KNOWN_PROTOCOL_VERSIONS: Final" "$PY"/x-mcp_types-*/mcp_types/version.py 2>/dev/null | head -10

# ---------------------- 13. this package, measured with the same grid
echo; echo "### 13. mcp-opentelemetry (this repository, read only)"
LOCAL="${LOCAL_PKG:-$(cd "$(dirname "$0")/.." && pwd)}"
if [ -d "$LOCAL/src" ]; then
  grep -n "SpanKind\.\|startSpan(\|propagator.inject\|propagator.extract\|links\|isRequest\|isResponse" "$LOCAL/src/instrumentation.ts"
  echo "-- metric constants defined but never used --"
  grep -c "METRIC_MCP" "$LOCAL/src/semconv.ts"
  grep -c "getMeter\|METRIC_MCP" "$LOCAL/src/instrumentation.ts"
else
  echo "local package not found: $LOCAL"
fi

echo; echo "### Done. Work dir: $WORK"
