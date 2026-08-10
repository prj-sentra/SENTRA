#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export WINEPREFIX="${WINEPREFIX:-/opt/wineprefix}"
export MT5_RPC_BIND_HOST="${MT5_RPC_BIND_HOST:-0.0.0.0}"
export MT5_RPC_PORT="${MT5_RPC_PORT:-18812}"
export MT5_BROKER_SERVER="${MT5_BROKER_SERVER:-XMGlobal-MT5 14}"

MT5_INSTALLER_URL="https://download.mql5.com/cdn/web/metaquotes.ltd/mt5/mt5setup.exe"
MT5_INSTALL_DIR="${WINEPREFIX}/drive_c/Program Files/MetaTrader 5"
MT5_TERMINAL_EXE="${MT5_INSTALL_DIR}/terminal64.exe"
MT5_CONFIG_PATH="${MT5_INSTALL_DIR}/mt5cfg.ini"

wine_version_raw="$(wine --version)"
wine_version_number="${wine_version_raw#wine-}"
wine_version_number="${wine_version_number%%[^0-9.]*}"
wine_major="${wine_version_number%%.*}"

if [[ -z "${wine_major}" || "${wine_major}" -lt 10 ]]; then
  echo "Wine major version must be >= 10, got: ${wine_version_raw}" >&2
  exit 1
fi

mkdir -p /app/output
rm -f /tmp/.X99-lock
Xvfb "$DISPLAY" -screen 0 1280x720x24 >/app/output/xvfb.log 2>&1 &
XVFB_PID=$!
fluxbox >/app/output/fluxbox.log 2>&1 &
FLUXBOX_PID=$!
cleanup() {
  if kill -0 "$FLUXBOX_PID" >/dev/null 2>&1; then
    kill "$FLUXBOX_PID"
  fi
  if kill -0 "$XVFB_PID" >/dev/null 2>&1; then
    kill "$XVFB_PID"
  fi
}
trap cleanup EXIT
sleep 2

if [[ ! -f "$MT5_TERMINAL_EXE" ]]; then
  echo "Installing MetaTrader 5 under Wine..."
  curl --fail --location --retry 5 --output /tmp/mt5setup.exe "$MT5_INSTALLER_URL"
  wine start /wait /unix /tmp/mt5setup.exe /auto
  wine taskkill /IM terminal64.exe /F >/dev/null 2>&1 || true
  wineserver -w
fi

if [[ ! -f "$MT5_TERMINAL_EXE" ]]; then
  echo "MetaTrader 5 install did not produce terminal64.exe" >&2
  exit 1
fi

cat > "$MT5_CONFIG_PATH" <<'EOF'
[Common]
NewsEnable=0
Profile=Blank
ProxyEnable=0
[Charts]
MaxBars=1000000
SelectOneClick=1
[Experts]
Enabled=1
Account=0
Profile=0
Chart=0
Api=0
[Events]
Enable=0
NewsEnable=0
EOF

cd "$MT5_INSTALL_DIR"
echo "Starting MetaTrader 5 terminal..."
wine terminal64.exe /config:mt5cfg.ini >/app/output/mt5-terminal.log 2>&1 &

echo "Waiting 20s for MT5 terminal bootstrap..."
sleep 20

if ! pgrep -fa 'terminal64\.exe' >/dev/null 2>&1; then
  echo "MetaTrader 5 terminal process did not stay up" >&2
  tail -n 200 /app/output/mt5-terminal.log >&2 || true
  exit 1
fi
shopt -s nullglob
wine_python_candidates=("${WINEPREFIX}"/drive_c/Python*/python.exe)
shopt -u nullglob
if [[ ${#wine_python_candidates[@]} -eq 0 ]]; then
  echo "Windows Python installation not found under ${WINEPREFIX}/drive_c" >&2
  exit 1
fi
WINE_PYTHON_EXE="${wine_python_candidates[0]}"


echo "Starting mt5linux RPC on ${MT5_RPC_BIND_HOST}:${MT5_RPC_PORT} for broker ${MT5_BROKER_SERVER}"
exec wine "$WINE_PYTHON_EXE" -m mt5linux --host "$MT5_RPC_BIND_HOST" --port "$MT5_RPC_PORT"
