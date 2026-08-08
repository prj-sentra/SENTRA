#!/bin/sh
set -eu

cd "$(dirname "$0")"
project="trading-journal-caddy-test-$$"
cleanup() {
  docker compose -p "$project" -f docker-compose.test.yml down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose -p "$project" -f docker-compose.test.yml up --detach --wait

assert_response() {
  path=$1
  expected=$2
  actual=$(curl --fail --silent --show-error "http://127.0.0.1:18080$path")
  if [ "$actual" != "$expected" ]; then
    printf 'Unexpected response for %s\nexpected: %s\nactual:   %s\n' "$path" "$expected" "$actual" >&2
    exit 1
  fi
}

assert_response '/api/mt5-accounts/account-1/sync' '{"path":"/mt5-accounts/account-1/sync","token":"composed-test-secret"}'
assert_response '/api/mt5-accounts/account-1/sync/extra' '{"path":"/mt5-accounts/account-1/sync/extra","token":null}'
assert_response '/api/mt5-accounts/account-1' '{"path":"/mt5-accounts/account-1","token":null}'
assert_response '/api/mt5-accounts//sync' '{"path":"/mt5-accounts/sync","token":null}'
assert_response '/' 'web'

printf 'Caddy routing and sync-token isolation verified.\n'
