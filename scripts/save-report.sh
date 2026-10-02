#!/usr/bin/env bash
# Pushes a run's report onto the ci-logs branch so it can be read without
# opening the Actions log. Usage: save-report.sh <name> <file>
set -euo pipefail
name="$1"; file="$2"
[ -f "$file" ] || echo "(no report written)" > "$file"
sha="${GITHUB_SHA::8}"
tmp=$(mktemp -d)
cp "$file" "$tmp/report.txt"
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
for i in 1 2 3 4; do
  rm -rf "$tmp/logs"
  if git ls-remote --exit-code origin ci-logs >/dev/null 2>&1; then
    git clone -q --depth 1 --branch ci-logs "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$tmp/logs"
  else
    mkdir -p "$tmp/logs" && git -C "$tmp/logs" init -q -b ci-logs
    git -C "$tmp/logs" remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
  fi
  { echo "run: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"; echo "when: $(date -u +%FT%TZ)"; echo; tail -n 300 "$tmp/report.txt"; } > "$tmp/logs/$name-$sha.txt"
  cp "$tmp/logs/$name-$sha.txt" "$tmp/logs/$name-latest.txt"
  git -C "$tmp/logs" add -A
  git -C "$tmp/logs" -c user.name="github-actions[bot]" -c user.email="github-actions[bot]@users.noreply.github.com" commit -qm "$name $sha" || exit 0
  git -C "$tmp/logs" push -q origin HEAD:ci-logs && exit 0
  sleep 3
done
