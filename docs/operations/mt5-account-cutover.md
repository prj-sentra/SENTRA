# MT5 account cutover

## Preconditions

1. Back up PostgreSQL and verify restore access.
2. Deploy the bridge on a private network and verify TLS where traffic leaves the host.
3. Provision a read-only MT5 credential and a unique bridge bearer token.
4. Set `MT5_BRIDGE_BASE_URL`, `MT5_BRIDGE_TOKEN`, and `MT5_BRIDGE_TIMEOUT_MS` for the API. Set `MT5_SYNC_TOKEN` only for the Caddy sync endpoint that requires it; never reuse either token.
5. Confirm the public proxy cannot route to the bridge or private API endpoints.

## Legacy gallery preparation and write freeze

The filesystem manifest is part of the database migration input, not an optional audit. Before preparing it:

1. Stop every API/web worker that can create, replace, or delete trade chart images and keep that write freeze in place through migration verification and deployment.
2. Mount the legacy image volume read-only at a stable absolute path and export it explicitly:
   ```sh
   export LEGACY_IMAGE_VOLUME=/srv/trading-journal/images
   test -d "$LEGACY_IMAGE_VOLUME"
   ```
3. Generate and load the manifest while connected to the isolated migration-verification database:
   ```sh
   LEGACY_IMAGE_VOLUME="$LEGACY_IMAGE_VOLUME" \
   MIGRATION_VERIFY_DATABASE_URL='postgresql://…/trading_journal_verify' \
   pnpm --filter @trading-journal/api prepare:migration:secure-accounts-gallery
   ```
4. Run the executable verifier against that same isolated database:
   ```sh
   MIGRATION_VERIFY_DATABASE_URL='postgresql://…/trading_journal_verify' \
   pnpm --filter @trading-journal/api test:migration:secure-accounts-gallery
   ```

Preparation must fail on missing or extra files, duplicate image IDs, byte-size differences, or SHA-256 differences. Do not deploy if it does. Retain the generated manifest, its loader output, the verifier output, and the database backup together as cutover audit evidence. Never point verification at production: the verifier requires an empty database and intentionally exercises failing migrations and reruns.

## Cutover

1. Complete the write freeze and manifest procedure above; keep image writes frozen until the migrated API is healthy.
2. Deploy database migrations before starting the new API.
3. Start the bridge, then the API, and verify `/health` through Caddy.
4. Create or replace the MT5 account through the authenticated application flow. Never insert encrypted credentials manually.
5. Trigger one sync and verify that the account identity matches, the lease completes, facts and projected trades commit together, and the returned cursor is stored byte-for-byte.
6. Trigger a second sync from the stored cursor and verify idempotency.
7. Verify another user cannot read, modify, sync, or infer the account by identifier.
8. Deactivate a test account during an in-flight sync and verify stale output is rejected with no cursor advancement.

## Rollback and rotation

On validation, identity, or fence failures, disable sync initiation and preserve the database for investigation. Do not edit cursors or delete fact rows. Roll back application containers only when their schema contract remains compatible; otherwise restore the verified backup as a coordinated outage.

Rotate a bridge token by accepting the new token at the bridge, updating the API secret, restarting the API, verifying a sync, then revoking the old token. Rotate an MT5 password through the account replacement flow so it serializes against active leases. Re-run the two-sync and stale-output checks after any credential, bridge, proxy, or database change.
