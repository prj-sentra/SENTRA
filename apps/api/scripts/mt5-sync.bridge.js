#!/usr/bin/env node

const payload = process.env.MT5_SYNC_BRIDGE_STDOUT ?? JSON.stringify({
  rawText: 'mt5 sync',
  source: 'api',
  actions: [],
});

process.stdout.write(payload);
