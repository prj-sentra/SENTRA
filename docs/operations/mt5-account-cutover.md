# MT5 account cutover

## Preconditions

1. Back up PostgreSQL and verify restore access.
2. Deploy the bridge on a private network and verify TLS where traffic leaves the host.
3. Provision a read-only MT5 credential and a unique bridge bearer token.
4. Set `MT5_BRIDGE_BASE_URL`, `MT5_BRIDGE_TOKEN`, and `MT5_BRIDGE_TIMEOUT_MS` for the API. Set `MT5_SYNC_TOKEN` only for the Caddy sync endpoint that requires it; never reuse either token.
5. Confirm the public proxy cannot route to the bridge or private API endpoints.

## Cutover

1. Deploy database migrations before starting the new API.
2. Start the bridge, then the API, and verify `/health` through Caddy.
3. Create or replace the MT5 account through the authenticated application flow. Never insert encrypted credentials manually.
4. Trigger one sync and verify that the account identity matches, the lease completes, facts and projected trades commit together, and the returned cursor is stored byte-for-byte.
5. Trigger a second sync from the stored cursor and verify idempotency.
6. Verify another user cannot read, modify, sync, or infer the account by identifier.
7. Deactivate a test account during an in-flight sync and verify stale output is rejected with no cursor advancement.

## Rollback and rotation

On validation, identity, or fence failures, disable sync initiation and preserve the database for investigation. Do not edit cursors or delete fact rows. Roll back application containers only when their schema contract remains compatible; otherwise restore the verified backup as a coordinated outage.

Rotate a bridge token by accepting the new token at the bridge, updating the API secret, restarting the API, verifying a sync, then revoking the old token. Rotate an MT5 password through the account replacement flow so it serializes against active leases. Re-run the two-sync and stale-output checks after any credential, bridge, proxy, or database change.
