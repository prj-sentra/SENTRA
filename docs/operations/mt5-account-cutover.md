# MT5 account cutover

## Preconditions

1. Back up PostgreSQL and verify restore access.
2. Deploy the bridge on a private network and verify TLS where traffic leaves the host.
3. Provision a read-only MT5 credential and a unique bridge bearer token.
4. Set `MT5_BRIDGE_BASE_URL`, `MT5_BRIDGE_TOKEN`, and `MT5_BRIDGE_TIMEOUT_MS` for the API. Set `MT5_SYNC_TOKEN` only for the Caddy sync endpoint that requires it; never reuse either token.
5. Confirm the public proxy cannot route to the bridge or private API endpoints.
6. Verify the bridge exposes only contractVersion 5 with fixed-snapshot bootstrap/incremental pagination. Before enabling sync, run the isolated provenance verifier: `MIGRATION_VERIFY_DATABASE_URL='postgresql://…/trading_journal_verify' pnpm --filter @trading-journal/api test:migration:provenance-mt5-position-entry-balances`. The migration preserves raw/authored/manual data and the last successful snapshot, nulls only legacy MT5 seeds, and is restore-only rollback.

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

## Clean-checkout release verification

Run the release gate from tracked source only. This proves the migration history and verifier are present in the packaged release rather than supplied by a developer's untracked files:

```sh
mkdir -p "$CLEAN_CHECKOUT"
git archive --format=tar HEAD | tar -xf - -C "$CLEAN_CHECKOUT"
cd "$CLEAN_CHECKOUT"
corepack pnpm install --frozen-lockfile
pnpm --filter @trading-journal/api prisma:generate
DATABASE_URL='postgresql://…/trading_journal_empty' \
  pnpm --filter @trading-journal/api prisma:migrate
MIGRATION_VERIFY_DATABASE_URL='postgresql://…/trading_journal_verify' \
  pnpm --filter @trading-journal/api test:migration:secure-accounts-gallery
```

`trading_journal_empty` and `trading_journal_verify` must be separate empty, disposable databases. Archive the command output with the manifest and backup evidence.

## Cutover

1. Complete the write freeze and manifest procedure above; keep image writes frozen until the migrated API is healthy.
2. Deploy database migrations before starting the new API.
3. Start the bridge, then the API, and verify `/health` through Caddy.
4. Create or replace the MT5 account through the authenticated application flow. Never insert encrypted credentials manually.
5. Trigger bootstrap sync and verify that every page uses the same `snapshotToMsc`, each response is below 1 MiB, every non-final page durably stores `page.nextCursor` before releasing its lease, and bootstrap projection occurs only after the final page.
6. Verify the final page clears mode/page cursor/error state, records `lastSuccessfulSnapshotMsc`, and leaves no lease. Trigger an incremental sync and verify the 72-hour overlap plus persisted open-position set is idempotent.
7. Verify another user cannot read, modify, sync, or infer the account by identifier.
8. Deactivate a test account during an in-flight sync and verify stale output is rejected with no page-cursor or successful-snapshot advancement.

## Empty MT5 campaign recovery

This is a one-time incident procedure, not routine maintenance. A reviewed 39-ID set and its incident bounds are execution-time evidence gates, not pre-authorization to delete anything. Never broaden the IDs, weaken a gate to fit the count, delete all empty campaigns, edit cursors, or reset journal data.

Keep one continuous maintenance freeze: disable normal writers and automatic sync, take a fresh production backup, and prove that backup restores in isolation. While still frozen, deploy the repaired API image that is compatible with the current schema. Do not unfreeze between backup, dry-run, apply, changed-history replay, and unchanged-cursor replay.

Generate a new manifest against the frozen production database. The dry run accepts only the independently reviewed ID JSON and per-ID incident-evidence JSON; it validates the exact count, topology, references, incident bounds, and database fingerprint, then records the current script and query hashes before exclusively creating the manifest file.

```sh
export RECOVERY_DATABASE_URL='postgresql://…/trading_journal'
export MANIFEST=/secure/evidence/empty-mt5-campaigns.manifest.json
pnpm --filter @trading-journal/api recover:empty-mt5-campaigns:dry-run -- \
  --manifest "$MANIFEST" \
  --reviewed-ids /secure/evidence/reviewed-39-ids.json \
  --incident-evidence /secure/evidence/reviewed-39-incident-evidence.json \
  --incident-start '2026-…T…:…:…Z' \
  --incident-end '2026-…T…:…:…Z'
```

An independent reviewer must approve the manifest, its SHA-256, the current script SHA-256, and the manifest's database fingerprint during that window. Apply is deliberately unavailable without all bindings, the exact count, incident bounds, and the explicit confirmation token:

```sh
export MANIFEST_SHA256='reviewed manifest SHA-256'
export SCRIPT_SHA256="$(sha256sum apps/api/scripts/recover-empty-mt5-campaigns.ts | cut -d ' ' -f 1)"
export DATABASE_FINGERPRINT='reviewed manifest databaseFingerprint'
pnpm --filter @trading-journal/api recover:empty-mt5-campaigns:apply -- \
  --manifest "$MANIFEST" \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --script-sha256 "$SCRIPT_SHA256" \
  --database-fingerprint "$DATABASE_FINGERPRINT" \
  --incident-start '2026-…T…:…:…Z' \
  --incident-end '2026-…T…:…:…Z' \
  --expected-count 39 \
  --confirm-delete-empty-mt5-campaigns
```

The apply transaction takes the fixed recovery locks, repeats the manifest topology and baseline checks, and requires `DELETE ... RETURNING` to equal the approved IDs exactly. The manifest’s canonical protected snapshot covers authored root Trade, TradeAnalysis, archive, indicator, entry, and exit content; every conflict row including canonical JSON bytes; all noncandidate campaigns and memberships; image metadata and file SHA-256 evidence where stored; and the affected-account MT5 deals, orders, balances, and sync cursors. It is compared again under lock before deletion and again after exact deletion before commit. A timeout, stale hash/fingerprint, count/bounds mismatch, or locked provenance/baseline/protected-snapshot drift rolls back; it is never permission to retry with different IDs. Independent postflight remains an additional gate, not a substitute for the in-transaction snapshots.

Before replaying, independently record postflight evidence that only the approved returned IDs changed and the protected root, destination membership, conflict, image, fact, cursor, analysis, and authored journal records remain intact. Then, still frozen, enable only operator-trusted sync: first perform a changed-history replay and confirm it creates no empty campaign; then perform an unchanged-cursor replay and confirm it is idempotent. Archive the backup/restore proof, manifest and hashes, reviewed approval, transaction result, postflight comparison, and both replay results before re-enabling normal traffic.

If a gate fails before commit, keep traffic disabled and investigate. If the repaired deployment fails before apply, disable sync and roll back only to a schema-compatible image while frozen. If cleanup committed and rollback is required, keep the freeze and restore the fresh verified pre-apply backup as a coordinated outage; never manually recreate campaigns, memberships, conflicts, images, facts, or cursors and never rerun apply without a new backup, manifest, and approval.
## Rollback and rotation

On validation, identity, or fence failures, disable sync initiation and preserve the database for investigation. Do not edit cursors or delete fact rows. Roll back application containers only when their schema contract remains compatible; otherwise restore the verified backup as a coordinated outage.

Rotate a bridge token by accepting the new token at the bridge, updating the API secret, restarting the API, verifying a sync, then revoking the old token. Rotate an MT5 password through the account replacement flow so it serializes against active leases. Re-run the two-sync and stale-output checks after any credential, bridge, proxy, or database change.
