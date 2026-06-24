#!/usr/bin/env bash
# AgentHub load test — concurrent /health endpoint stress test.
#
# Hits the health endpoint N times with controlled concurrency, measures
# latency percentiles, and reports error rate. Pure bash + curl — no
# external dependencies.
#
# Usage:
#   ./scripts/load-test.sh                           # default: 1000 req, 50 concurrent
#   ./scripts/load-test.sh -n 5000 -c 100            # custom load
#   ./scripts/load-test.sh -url http://127.0.0.1:3210/v1/health
#
# Options:
#   -n        Total requests (default: 1000)
#   -c        Concurrency level (default: 50)
#   -url      Target URL (default: http://127.0.0.1:8080/health)
#   -timeout  Per-request timeout in seconds (default: 10)
set -euo pipefail

# --- Defaults ---
TOTAL=1000
CONCURRENCY=50
URL="http://127.0.0.1:8080/health"
TIMEOUT=10

# --- Parse args ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        -n) TOTAL="$2"; shift 2 ;;
        -c) CONCURRENCY="$2"; shift 2 ;;
        -url) URL="$2"; shift 2 ;;
        -timeout) TIMEOUT="$2"; shift 2 ;;
        -h|--help)
            printf 'Usage: %s [-n requests] [-c concurrency] [-url target] [-timeout sec]\n' "$(basename "$0")"
            printf '\nDefaults: -n %s -c %s -url %s -timeout %s\n' "$TOTAL" "$CONCURRENCY" "$URL" "$TIMEOUT"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 2 ;;
    esac
done

# --- Setup ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESULT_DIR="${TMPDIR:-/tmp}/agenthub-load-test-${TIMESTAMP}"
mkdir -p "$RESULT_DIR"
RESULTS_FILE="$RESULT_DIR/results.txt"
TIMING_FILE="$RESULT_DIR/timings.txt"

# --- Color helpers ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

banner()    { printf '\n%b=== %s ===%b\n' "$CYAN" "$1" "$NC"; }
info()      { printf '  %s\n' "$1"; }
good()      { printf '%b  OK   %s%b\n' "$GREEN" "$1" "$NC"; }
warn()      { printf '%b  WARN %s%b\n' "$YELLOW" "$1" "$NC"; }
bad()       { printf '%b  FAIL %s%b\n' "$RED" "$1" "$NC"; }
metric()    { printf '  %-24s %b%s%b\n' "$1" "$BOLD" "$2" "$NC"; }

# --- Prerequisites ---
command -v curl  >/dev/null 2>&1 || { echo "ERROR: curl is required"; exit 1; }
command -v bc    >/dev/null 2>&1 || { echo "ERROR: bc is required"; exit 1; }
command -v sort  >/dev/null 2>&1 || { echo "ERROR: sort is required"; exit 1; }
command -v awk   >/dev/null 2>&1 || { echo "ERROR: awk is required"; exit 1; }

# --- Quick pre-flight ---
if ! curl -sS --max-time 3 "$URL" >/dev/null 2>&1; then
    bad "Pre-flight: $URL is not reachable. Is the service running?"
    exit 1
fi
good "Pre-flight: $URL is reachable"

# --- Run load test ---
banner "Load Test: $TOTAL requests, $CONCURRENCY concurrent"
info "Target: $URL"
info "Results: $RESULT_DIR"

START_TIME="$(date +%s.%N)"

COMPLETED=0
ERRORS=0
ACTIVE=0

# Progress reporting
progress() {
    local done="$1" err="$2" total="$3"
    local pct=$(( done * 100 / total ))
    printf '\r  Progress: %d/%d (%d%%)  errors: %d  active: %d   ' "$done" "$total" "$pct" "$err" "$ACTIVE"
}

# Single request worker: fetch URL, record timing + status
do_request() {
    local id="$1"
    local tmpfile="$RESULT_DIR/req-${id}.tmp"

    local curl_exit=0
    curl -sS -o /dev/null -w '%{http_code} %{time_total} %{time_connect} %{time_starttransfer}\n' \
        --max-time "$TIMEOUT" \
        "$URL" >"$tmpfile" 2>/dev/null || curl_exit=$?

    if [[ "$curl_exit" -ne 0 ]]; then
        echo "000 0.000 0.000 0.000" >"$tmpfile"
    fi
}

# Spawn requests in batches to respect concurrency limit
info "Starting requests..."

REMAINING=$TOTAL
NEXT_ID=1

while [[ $REMAINING -gt 0 ]]; do
    BATCH_SIZE=$CONCURRENCY
    if [[ $REMAINING -lt $CONCURRENCY ]]; then
        BATCH_SIZE=$REMAINING
    fi

    # Launch batch
    for ((i=0; i<BATCH_SIZE; i++)); do
        do_request "$NEXT_ID" &
        NEXT_ID=$((NEXT_ID + 1))
    done

    # Wait for batch to finish
    wait

    REMAINING=$((REMAINING - BATCH_SIZE))
    COMPLETED=$((COMPLETED + BATCH_SIZE))
    ACTIVE=0

    progress "$COMPLETED" "$ERRORS" "$TOTAL"
done

END_TIME="$(date +%s.%N)"

echo ""  # newline after progress bar

# --- Aggregate results ---
banner "Aggregating results"

HTTP_OK=0
HTTP_ERR=0
CONNECT_FAIL=0

# Read all result files
> "$RESULTS_FILE"
for f in "$RESULT_DIR"/req-*.tmp; do
    if [[ -f "$f" ]]; then
        cat "$f" >> "$RESULTS_FILE"
    fi
done

TOTAL_RECORDS=$(wc -l < "$RESULTS_FILE" | tr -d ' ')

# Extract timings for successful requests (http_code 2xx or 3xx)
# and count errors
while IFS=' ' read -r code time_total time_connect time_starttransfer; do
    if [[ "$code" =~ ^2 ]] || [[ "$code" =~ ^3 ]]; then
        HTTP_OK=$((HTTP_OK + 1))
        echo "$time_total" >> "$TIMING_FILE"
    elif [[ "$code" == "000" ]]; then
        CONNECT_FAIL=$((CONNECT_FAIL + 1))
        HTTP_ERR=$((HTTP_ERR + 1))
    else
        HTTP_ERR=$((HTTP_ERR + 1))
        echo "$time_total" >> "$TIMING_FILE"
    fi
done < "$RESULTS_FILE"

ERROR_RATE=0
if [[ "$TOTAL_RECORDS" -gt 0 ]]; then
    ERROR_RATE=$(echo "scale=4; $HTTP_ERR * 100 / $TOTAL_RECORDS" | bc)
fi

# --- Compute statistics ---
compute_percentile() {
    local pct="$1"
    local file="$2"
    local total_lines="$3"
    if [[ "$total_lines" -eq 0 ]]; then
        echo "N/A"
        return
    fi
    local idx
    idx=$(echo "scale=0; ($pct * $total_lines / 100) + 0.5" | bc | cut -d. -f1)
    [[ "$idx" -lt 1 ]] && idx=1
    [[ "$idx" -gt "$total_lines" ]] && idx="$total_lines"
    sort -n "$file" | sed -n "${idx}p"
}

SORTED_COUNT=$(wc -l < "$TIMING_FILE" 2>/dev/null | tr -d ' ' || echo 0)

if [[ "$SORTED_COUNT" -gt 0 ]]; then
    MIN=$(sort -n "$TIMING_FILE" | head -1)
    MAX=$(sort -n "$TIMING_FILE" | tail -1)
    AVG=$(awk '{sum+=$1; n++} END {if(n>0) printf "%.4f", sum/n}' "$TIMING_FILE")
    P50=$(compute_percentile 50 "$TIMING_FILE" "$SORTED_COUNT")
    P90=$(compute_percentile 90 "$TIMING_FILE" "$SORTED_COUNT")
    P95=$(compute_percentile 95 "$TIMING_FILE" "$SORTED_COUNT")
    P99=$(compute_percentile 99 "$TIMING_FILE" "$SORTED_COUNT")

    # Standard deviation
    STDDEV=$(awk -v avg="$AVG" '{sum+=($1-avg)^2; n++} END {if(n>0) printf "%.4f", sqrt(sum/n)}' "$TIMING_FILE")
else
    MIN="N/A"; MAX="N/A"; AVG="N/A"
    P50="N/A"; P90="N/A"; P95="N/A"; P99="N/A"
    STDDEV="N/A"
fi

# --- Report ---
banner "Latency Report (seconds)"

metric "Requests completed"    "$TOTAL_RECORDS"
metric "HTTP 2xx/3xx"          "$HTTP_OK"
metric "HTTP errors"           "$HTTP_ERR"
metric "Connection failures"   "$CONNECT_FAIL"
metric "Error rate"            "${ERROR_RATE}%"
echo ""
metric "Min"                   "${MIN}"
metric "Max"                   "${MAX}"
metric "Average"               "${AVG}"
metric "StdDev"                "${STDDEV}"
echo ""
metric "P50 (median)"          "${P50}"
metric "P90"                   "${P90}"
metric "P95"                   "${P95}"
metric "P99"                   "${P99}"

# --- Wall-clock duration ---
WALL_TIME=$(echo "scale=3; $END_TIME - $START_TIME" | bc)
THROUGHPUT=$(echo "scale=1; $TOTAL_RECORDS / $WALL_TIME" | bc 2>/dev/null || echo "N/A")

echo ""
metric "Wall-clock duration"   "${WALL_TIME}s"
metric "Throughput"            "${THROUGHPUT} req/s"

# --- Interpretation hints ---
banner "Interpretation hints"
echo ""
if [[ "$SORTED_COUNT" -gt 0 ]]; then
    P50_NUM=$(echo "$P50" | sed 's/[^0-9.]//g')
    P99_NUM=$(echo "$P99" | sed 's/[^0-9.]//g')

    if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
        P50_MS=$(echo "scale=1; $P50 * 1000" | bc 2>/dev/null || echo "N/A")
        P99_MS=$(echo "scale=1; $P99 * 1000" | bc 2>/dev/null || echo "N/A")
        AVG_MS=$(echo "scale=1; $AVG * 1000" | bc 2>/dev/null || echo "N/A")
        info "P50: ${P50_MS}ms  |  P99: ${P99_MS}ms  |  Avg: ${AVG_MS}ms"
    fi

    # Error rate assessment
    ER_NUM=$(echo "$ERROR_RATE" | sed 's/[^0-9.]//g')
    if [[ -n "$ER_NUM" ]]; then
        if (( $(echo "$ER_NUM > 1.0" | bc -l 2>/dev/null || echo 0) )); then
            bad "Error rate ${ERROR_RATE}% is above 1% — investigate service health and capacity."
        elif (( $(echo "$ER_NUM > 0.0" | bc -l 2>/dev/null || echo 0) )); then
            warn "Non-zero error rate ${ERROR_RATE}% — monitor for regression on subsequent runs."
        else
            good "Error rate is 0% — all requests succeeded."
        fi
    fi

    # Latency assessment
    if [[ -n "$P99_NUM" ]] && [[ "$P99_NUM" != "N/A" ]]; then
        if (( $(echo "$P99_NUM > 1.0" | bc -l 2>/dev/null || echo 0) )); then
            warn "P99 latency > 1s — tail latency is high; consider profiling or capacity increase."
        elif (( $(echo "$P99_NUM > 0.2" | bc -l 2>/dev/null || echo 0) )); then
            info "P99 latency is moderate ($P99 s). Acceptable for a local dev server."
        else
            good "P99 latency < 200ms — healthy for a local instance."
        fi
    fi
fi

echo ""
info "Raw results kept at: $RESULT_DIR"
info "Request details:  $RESULTS_FILE"
info "Timing data:      $TIMING_FILE"
echo ""

# --- Exit code ---
if [[ "$HTTP_ERR" -gt 0 ]]; then
    exit 1
fi
exit 0
