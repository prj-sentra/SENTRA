#!/usr/bin/env node
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  const [apiImage, webImage] = process.argv.slice(2);
  const config = JSON.parse(raw);
  const api = config.services?.api;
  const web = config.services?.web;
  const env = (service) => Array.isArray(service?.environment)
    ? Object.fromEntries(service.environment.map((entry) => entry.split(/=(.*)/s, 2)))
    : service?.environment ?? {};
  if (!api || !web || api.image !== apiImage || web.image !== webImage) process.exit(2);
  if ('build' in api || 'build' in web) process.exit(3);
  const apiEnv = env(api);
  for (const key of ['MFE_MAE_WRITE_ENABLED', 'MT5_EXCURSION_WRITE_ENABLED', 'MT5_EXCURSION_WORKER_ENABLED', 'MFE_MAE_BACKFILL_ENABLED']) {
    if (String(apiEnv[key]).toLowerCase() !== 'false') process.exit(4);
  }
});
