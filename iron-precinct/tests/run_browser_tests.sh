#!/usr/bin/env bash
# Run browser tests in headless Chromium against a throwaway server.
#   Usage: tests/run_browser_tests.sh [name ...]     (default: every tests/*.test.html)
# Each test page logs "TEST PASS <name>", "TEST FAIL <name> ...", and finally "TEST DONE".
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8199}
CH=${CHROME:-$(ls ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | tail -1)}
if [ -z "$CH" ]; then echo "No headless Chromium found (set CHROME=/path/to/chrome)"; exit 2; fi
[ -f /tmp/chromelibs/ldpath ] && export LD_LIBRARY_PATH=$(cat /tmp/chromelibs/ldpath)

python3 server.py --host 127.0.0.1 --port "$PORT" >/tmp/iron-precinct-test-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  for f in tests/*.test.html; do names+=("$(basename "$f" .test.html)"); done
fi

status=0
for n in "${names[@]}"; do
  echo "== $n"
  out=$(timeout 300 "$CH" --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
      --window-size=1280,800 --virtual-time-budget="${BUDGET:-120000}" --enable-logging=stderr --v=0 \
      --dump-dom "http://127.0.0.1:$PORT/tests/$n.test.html" 2>&1 >/dev/null \
    | grep -E 'CONSOLE.*\] "(TEST |Uncaught )' \
    | sed -E 's/^.*CONSOLE[^]]*\] "//; s/", source: [^,]*$//; s/^TEST //')
  echo "$out"
  if echo "$out" | grep -qE '^FAIL|^Uncaught'; then status=1; fi
  if ! echo "$out" | grep -q '^DONE'; then echo "(test page never reported DONE)"; status=1; fi
done
exit $status
