# MFE/MAE cutover

The deployed MT5 `/sync` v5 contract is unchanged. MFE/MAE uses separate,
authenticated `/capabilities` and `/ticks` endpoints with an independent
`ticks-v1` cursor.

## Required order

1. Back up PostgreSQL and record the current API/web image digests.
2. Push the bridge revision and pull/restart it on Windows.
3. Validate `/capabilities`, multi-page `/ticks`, cursor rejection and one
   Long/Short/scale-in sample. Do not continue if tick evidence differs from MT5.
4. Deploy the journal migration with all three feature gates `false`.
5. Verify ordinary v5 synchronization and cursor/watermark behavior.
6. Set `MT5_EXCURSION_WRITE_ENABLED=true` and
   `MT5_EXCURSION_WORKER_ENABLED=true` with
   `MT5_EXCURSION_WORKER_ACCOUNT_IDS=<one-approved-account-id>`.
7. Observe at least 100 completed targets or 24 hours, whichever is later.
8. Run `pnpm --filter @trading-journal/api backfill:mfe-mae:dry-run`, review
   the exact selected manifest, then use the confirmed apply command.

## Reviewed historical backfill

The dry run emits a signed M1 manifest. M1 is valid for 15 minutes and is the
only authority for its exact ordered selection. Apply it only with:

```bash
MFE_MAE_BACKFILL_ENABLED=true pnpm --filter @trading-journal/api backfill:mfe-mae:apply \
  -- --account-id <account-id> --batch-manifest '<M1>' --confirm-backfill-mfe-mae
```

An expired M1 must never be edited, regenerated from its selected IDs, or
applied. Reauthorize that exact signed M1 instead:

```bash
pnpm --filter @trading-journal/api exec ts-node -r tsconfig-paths/register scripts/backfill-mfe-mae.ts \
  --reauthorize --account-id <account-id> --batch-manifest '<expired-M1>'
```

Reauthorization checks the account, complete database fingerprint, and every
selected target input before issuing a signed five-minute R1. R1 contains the
same exact selection and an identity digest of its M1; it does not replace,
expand, or otherwise substitute the original review. Apply an R1 only by
supplying both original signed tokens; the R1 SHA, selected batch fingerprint,
database fingerprint, and complete ordered selection must exactly match M1:

```bash
MFE_MAE_BACKFILL_ENABLED=true pnpm --filter @trading-journal/api backfill:mfe-mae:apply \
  -- --account-id <account-id> --batch-manifest '<original-M1>' \
  --reauthorization-manifest '<R1>' --confirm-backfill-mfe-mae
```

Normal apply never retries a `BLOCKED` work item. Retrying such an item requires
the dual-manifest command above plus the separate, explicit
`--confirm-retry-blocked-mfe-mae` acknowledgement. The retry transaction
revalidates the reviewed inputs and only resets the still-matching blocked row,
incrementing its manual retry epoch. Any fingerprint or selected-input drift
requires a new dry run and review.

Stop promotion on any sync regression, digest/cursor mismatch, stale/failed
result outside an approved unsupported symbol, or worker unit overrun. Disable
all gates first. Schema-compatible application rollback uses
`scripts/rollback-mfe-mae.sh`; it never builds the current checkout. Restore the
database only for confirmed schema/data corruption.

The worker uses `mt5_bridge_activity` as a cross-replica bridge slot. An
interactive sync records intent before waiting for the current worker unit;
the worker checks that intent before every new tick request and requeues from
its last durable checkpoint. Defaults are one global tick request, 10-second
units, 5 chunks, 20 pages, 20,000 ticks, and a 150 ms minimum page interval.
Transient bridge outages back off for five minutes, capacity for two minutes,
and deadlines for one minute. Tick identity or invalid-payload faults create a
durable `HALT` row and fail closed. Investigate the bridge and retained work
before explicitly clearing that row:

```sql
DELETE FROM mt5_bridge_activity WHERE kind = 'HALT';
```
