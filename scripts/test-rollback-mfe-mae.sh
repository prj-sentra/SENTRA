#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
api='registry.example/sentra/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
web='registry.example/sentra/web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
sandbox=$(mktemp -d)
trap 'rm -rf "$sandbox"' EXIT

mkdir -p "$sandbox/scripts" "$sandbox/bin"
cp "$root/scripts/rollback-mfe-mae.sh" "$root/scripts/verify-rollback-selector.mjs" "$sandbox/scripts/"
cp "$root/docker-compose.yml" "$root/docker-compose.prod.yml" "$root/docker-compose.rollback.yml" "$sandbox/"
cat >"$sandbox/.env" <<EOF
ROLLBACK_API_IMAGE_REPOSITORY=registry.example/sentra/api
ROLLBACK_WEB_IMAGE_REPOSITORY=registry.example/sentra/web
EOF
chmod 600 "$sandbox/.env"
[[ $(stat -c '%a' "$sandbox/.env") == 600 ]]

cat >"$sandbox/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >>"$DOCKER_LOG"
printf '\n' >>"$DOCKER_LOG"
case "$1" in
  pull)
    [[ $# == 2 ]] || exit 91
    ;;
  image)
    [[ "$2" == inspect && "$4" == --format && $# == 5 ]] || exit 92
    printf '%s\n' "$3"
    ;;
  compose)
    for argument in "$@"; do
      [[ "$argument" != --build ]] || exit 93
    done
    if [[ " $* " == *" config --format json "* ]]; then
      [[ ${API_ROLLBACK_IMAGE-} == "$EXPECTED_API" && ${WEB_ROLLBACK_IMAGE-} == "$EXPECTED_WEB" ]] || exit 94
      printf '%s\n' "$COMPOSE_CONFIG"
    else
      [[ " $* " == *" up -d --no-build --no-deps api web "* ]] || exit 95
    fi
    ;;
  *) exit 96 ;;
esac
EOF
chmod +x "$sandbox/bin/docker"

config='{"services":{"api":{"image":"'"$api"'","environment":{"MFE_MAE_WRITE_ENABLED":"false","MT5_EXCURSION_WRITE_ENABLED":"false","MT5_EXCURSION_WORKER_ENABLED":"false","MFE_MAE_BACKFILL_ENABLED":"false"}},"web":{"image":"'"$web"'"}}}'
run_rollback() {
  PATH="$sandbox/bin:$PATH" DOCKER_LOG="$sandbox/docker.log" EXPECTED_API="$api" EXPECTED_WEB="$web" COMPOSE_CONFIG="$config" \
    "$sandbox/scripts/rollback-mfe-mae.sh" --api "$1" --web "$2"
}
expect_fail() {
  if run_rollback "$1" "$web" >/dev/null 2>&1; then
    echo 'invalid rollback selector was accepted' >&2
    exit 1
  fi
}

: >"$sandbox/docker.log"
run_rollback "$api" "$web"
expect_fail 'not-a-selector'
expect_fail 'registry.example/sentra/api:latest'
expect_fail 'registry.example/sentra/other@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
expect_fail 'registry.example/sentra/api@sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
expect_fail 'registry.example/sentra/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

expected_log=$(cat <<EOF
pull $api 
pull $web 
image inspect $api --format \{\{range\ .RepoDigests\}\}\{\{println\ .\}\}\{\{end\}\} 
image inspect $web --format \{\{range\ .RepoDigests\}\}\{\{println\ .\}\}\{\{end\}\} 
compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.rollback.yml config --format json 
compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.rollback.yml up -d --no-build --no-deps api web 
EOF
)
[[ $(<"$sandbox/docker.log") == "$expected_log" ]]
[[ $(<"$sandbox/docker.log") != *--build* ]]
echo 'rollback shell tests passed'
