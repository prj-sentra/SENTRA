#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Production deployment requires $ROOT_DIR/.env" >&2
  exit 1
fi

# The checked-in deployment entrypoint deliberately replaces ambient shell values.
# This prevents an old exported token from taking precedence over the durable .env.
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${MT5_BRIDGE_BASE_URL:?MT5_BRIDGE_BASE_URL is required}"
: "${MT5_BRIDGE_TOKEN:?MT5_BRIDGE_TOKEN is required}"

compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
"${compose[@]}" config --quiet

resolved_token="$("${compose[@]}" config --format json | node -e '
let text = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => text += chunk);
process.stdin.on("end", () => {
  const config = JSON.parse(text);
  const environment = config.services?.api?.environment;
  const token = Array.isArray(environment)
    ? environment.find(value => value.startsWith("MT5_BRIDGE_TOKEN="))?.slice("MT5_BRIDGE_TOKEN=".length)
    : environment?.MT5_BRIDGE_TOKEN;
  if (typeof token !== "string") process.exit(2);
  process.stdout.write(token);
});
')"

if [[ "$resolved_token" != "$MT5_BRIDGE_TOKEN" ]]; then
  echo "Deployment blocked: Compose did not resolve MT5_BRIDGE_TOKEN from the durable .env." >&2
  exit 1
fi

if [[ "${1:-}" == "--check" ]]; then
  echo "Production deployment environment is consistent."
  exit 0
fi
"${compose[@]}" up -d --build "$@"
