#!/usr/bin/env node

if (!process.env.MT5_SYNC_BRIDGE_STDOUT) {
  process.stderr.write('MT5 sync bridge is not wired to a real MT5 data source.\n');
  process.exit(1);
}

process.stdout.write(process.env.MT5_SYNC_BRIDGE_STDOUT);
