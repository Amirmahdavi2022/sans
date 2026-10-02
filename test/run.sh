#!/usr/bin/env bash
# Full local check: mock upstream + wrangler dev + end-to-end tests.
set -euo pipefail
cd "$(dirname "$0")/.."
cat > .dev.vars <<VARS
TMDB_KEY=testkey
BOT_TOKEN=123456:TESTTOKEN
TMDB_API=http://127.0.0.1:8799/3
TMDB_IMG=http://127.0.0.1:8799/img
TG_API=http://127.0.0.1:8799
ARCHIVE_API=http://127.0.0.1:8799/archive
DEV=1
WEBHOOK_SECRET=s3cret
VARS
rm -rf .wrangler/state
node test/mock.mjs > /tmp/sans-mock.log 2>&1 &
MOCK=$!
npx wrangler d1 execute sans --local --file=schema.sql > /dev/null
npx wrangler dev --port 8787 --ip 127.0.0.1 --test-scheduled > /tmp/sans-dev.log 2>&1 &
DEV=$!
trap 'kill $MOCK $DEV 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -sf http://127.0.0.1:8787/api/health > /dev/null && break; sleep 1; done
node test/e2e.mjs
# alert job: mark an older episode as notified, run the cron, expect one alert
npx wrangler d1 execute sans --local --command "UPDATE follows SET notified='S2E4'; UPDATE shows SET checked_at=0;" > /dev/null
curl -sf "http://127.0.0.1:8787/__scheduled?cron=7+*+*+*+*" > /dev/null; sleep 2
curl -sf "http://127.0.0.1:8787/__scheduled?cron=7+*+*+*+*" > /dev/null; sleep 2
n=$(grep -c 'New episode\|قسمت جدید' /tmp/sans-mock.log || true)
[ "$n" = "1" ] && echo "ok alert sent exactly once" || { echo "FAIL alerts sent: $n"; exit 1; }
