#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
[[ -f .env ]] || { echo "Production rollback requires $ROOT_DIR/.env" >&2; exit 2; }
set -a
# shellcheck disable=SC1091
source .env
set +a

usage() { echo "usage: $0 --api <repository@sha256:digest> --web <repository@sha256:digest>" >&2; exit 2; }
[[ $# -eq 4 && $1 == --api && $3 == --web ]] || usage

API_ROLLBACK_IMAGE=$2
WEB_ROLLBACK_IMAGE=$4
validate_and_export_selector() {
  local variable_name=$1 repository_prefix=$2 value=${!1-} digest_prefix digest
  digest_prefix="${repository_prefix}@sha256:"
  [[ -n "$repository_prefix" && "$repository_prefix" != *'@'* && "$value" == "${digest_prefix}"* ]] || return 2
  digest=${value#"$digest_prefix"}
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 2
  export "$variable_name=$value"
}

: "${ROLLBACK_API_IMAGE_REPOSITORY:?ROLLBACK_API_IMAGE_REPOSITORY is required}"
: "${ROLLBACK_WEB_IMAGE_REPOSITORY:?ROLLBACK_WEB_IMAGE_REPOSITORY is required}"
validate_and_export_selector API_ROLLBACK_IMAGE "$ROLLBACK_API_IMAGE_REPOSITORY" || usage
validate_and_export_selector WEB_ROLLBACK_IMAGE "$ROLLBACK_WEB_IMAGE_REPOSITORY" || usage

docker pull "$API_ROLLBACK_IMAGE"
docker pull "$WEB_ROLLBACK_IMAGE"
docker image inspect "$API_ROLLBACK_IMAGE" --format '{{range .RepoDigests}}{{println .}}{{end}}' | grep -Fx "$API_ROLLBACK_IMAGE"
docker image inspect "$WEB_ROLLBACK_IMAGE" --format '{{range .RepoDigests}}{{println .}}{{end}}' | grep -Fx "$WEB_ROLLBACK_IMAGE"
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.rollback.yml config --format json |
  node scripts/verify-rollback-selector.mjs "$API_ROLLBACK_IMAGE" "$WEB_ROLLBACK_IMAGE"
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.rollback.yml \
  up -d --no-build --no-deps api web
