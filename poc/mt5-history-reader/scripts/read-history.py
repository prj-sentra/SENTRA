from __future__ import annotations

import json
import math
import os
import socket
import sys
import time
from datetime import date, datetime, time as dt_time, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

from mt5linux import MetaTrader5


def require_env(name: str, default: str | None = None, *, secret: bool = False) -> str:
    value = os.getenv(name, default)
    if value is None or value == "":
        label = "[secret]" if secret else ""
        raise SystemExit(f"Missing required environment variable {name}{label}")
    return value


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise SystemExit(f"Environment variable {name} must be an integer, got {raw!r}") from exc


def wait_for_rpc(host: str, port: int, timeout_seconds: int) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=2):
                return
        except OSError as exc:
            last_error = exc
            time.sleep(1)
    raise SystemExit(f"mt5linux RPC not reachable at {host}:{port}: {last_error}")


def serialize(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (datetime, date, dt_time)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "_asdict"):
        return {key: serialize(item) for key, item in value._asdict().items()}
    if isinstance(value, Mapping):
        return {str(key): serialize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [serialize(item) for item in value]
    if hasattr(value, "__dict__"):
        return {key: serialize(item) for key, item in vars(value).items()}
    return str(value)


def last_error_payload(mt5: MetaTrader5) -> Any:
    method = getattr(mt5, "last_error", None)
    if callable(method):
        try:
            return serialize(method())
        except Exception as exc:  # pragma: no cover - defensive only
            return {"error": str(exc)}
    return None


def main() -> int:
    login = env_int("MT5_LOGIN", 0)
    if login <= 0:
        raise SystemExit("MT5_LOGIN must be a positive integer")

    password = require_env("MT5_PASSWORD", secret=True)
    server = require_env("MT5_BROKER_SERVER", "XMGlobal-MT5 14")
    rpc_host = require_env("MT5_RPC_HOST", "127.0.0.1")
    rpc_port = env_int("MT5_RPC_PORT", 18812)
    rpc_ready_timeout = env_int("MT5_RPC_READY_TIMEOUT_SECONDS", 60)
    init_timeout_ms = env_int("MT5_INIT_TIMEOUT_MS", 60000)
    lookback_days = env_int("MT5_LOOKBACK_DAYS", 30)
    output_path = Path(require_env("MT5_OUTPUT_PATH", "/app/output/mt5-history.json"))
    terminal_path = require_env(
        "MT5_TERMINAL_PATH",
        r"C:\Program Files\MetaTrader 5\terminal64.exe",
    )

    wait_for_rpc(rpc_host, rpc_port, rpc_ready_timeout)

    mt5 = MetaTrader5(host=rpc_host, port=rpc_port, timeout=max(60, rpc_ready_timeout + 30))
    initialized = False
    try:
        initialized = bool(
            mt5.initialize(
                terminal_path,
                login=login,
                password=password,
                server=server,
                timeout=init_timeout_ms,
            )
        )
        if not initialized:
            raise SystemExit(
                f"mt5.initialize failed for server {server}: {last_error_payload(mt5)}"
            )

        window_end = datetime.now(timezone.utc)
        window_start = window_end - timedelta(days=lookback_days)

        account_info = mt5.account_info()
        terminal_info = mt5.terminal_info()
        orders = mt5.history_orders_get(window_start, window_end) or []
        deals = mt5.history_deals_get(window_start, window_end) or []

        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "broker_server": server,
            "lookback_days": lookback_days,
            "window": {
                "from": window_start.isoformat(),
                "to": window_end.isoformat(),
            },
            "account_info": serialize(account_info),
            "terminal_info": serialize(terminal_info),
            "history_orders_count": len(orders),
            "history_deals_count": len(deals),
            "history_orders": serialize(orders),
            "history_deals": serialize(deals),
        }

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {output_path}")
        return 0
    finally:
        if initialized:
            try:
                mt5.shutdown()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
