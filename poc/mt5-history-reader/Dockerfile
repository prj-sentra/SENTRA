FROM tobix/pywine:3.12

ENV WINEDEBUG=-all \
    DISPLAY=:99 \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    cabextract \
    curl \
    procps \
    python3 \
    python3-pip \
    python3-venv \
    unzip \
    winehq-stable \
    x11vnc \
    xvfb \
    fluxbox \
    python3-websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python3 - <<'PY'
import re
import subprocess

raw = subprocess.check_output(["wine", "--version"], text=True).strip()
match = re.search(r"(\d+)", raw)
if not match:
    raise SystemExit(f"Unable to parse wine version: {raw}")
major = int(match.group(1))
if major < 10:
    raise SystemExit(f"Wine major version must be >= 10, got {raw}")
print(f"Using {raw}")
PY

RUN curl -L -o /usr/bin/winetricks https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks \
    && chmod +x /usr/bin/winetricks \
    && xvfb-run -a sh -c "winetricks --unattended vcrun2019"

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir mt5linux \
    && xvfb-run -a wine pip install --no-cache-dir 'MetaTrader5>=5' 'numpy<2' mt5linux \
    && wineserver -w

COPY scripts/start-mt5.sh /app/scripts/start-mt5.sh
COPY scripts/read-history.py /app/scripts/read-history.py

RUN chmod +x /app/scripts/start-mt5.sh \
    && mkdir -p /app/output

ENTRYPOINT ["/app/scripts/start-mt5.sh"]
