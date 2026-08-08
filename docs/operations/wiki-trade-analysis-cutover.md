# Wiki to TradeAnalysis cutover runbook

This is the mandatory forward-only release procedure. The Release Captain records every command result, timestamp, operator, backup URI, SHA-256, byte size, image digest, and approval in `docs/operations/evidence/wiki-trade-analysis-cutover/<UTC-release-id>.md`.

## Preconditions and rehearsal

1. Schedule a maintenance window and quiesce **all** writers: web, API workers, assistant/automation, MT5 ingestion, and direct database jobs. Confirm no write requests or queued jobs remain.
2. Record the currently running API and web image IDs/digests and Compose project name. These are the rollback images.
3. Derive the Wiki volume identity from the active API container mount whose destination is `/data/wiki`; do not infer it from a name. Record the mount name, driver, labels, mountpoint, and size, then confirm its Compose labels identify the active project.
4. Back up PostgreSQL to durable storage and archive that exact Wiki volume. Record URI, SHA-256, size, and UTC timestamp for both. Restore the database backup into an isolated database and read the Wiki archive before continuing. Intentional Wiki-data discard requires explicit Release Captain approval recorded in evidence.
5. Capture frozen baseline counts and IDs for trades, entries, exits, chart rows/files, MT5 deals/orders, and the canonical ordered analysis JSON (excluding `updatedAt`) for the MT5 sentinel. Verify every baseline chart file is readable and save a manifest/checksum.
6. Rehearse this runbook from the restored snapshot with the recorded new API/web image digests. Run the migration harness and smoke checks. A failed rehearsal blocks production.

## Deployment and 30-minute gates

1. Stop the recorded old API and web writers together; keep the database, chart, and Caddy volumes intact.
2. Deploy the recorded new API and web images together. Confirm the API migration completed and startup succeeded.
3. Run smoke checks: health, retained Trade edit/save/reload, analysis patch, entry/exit, chart read/upload lifecycle, MT5 sentinel sync, and retired Wiki/tag/journal routes returning 404.
4. Observe for 30 uninterrupted minutes while writers remain controlled. The following gates must remain true:
   - baseline trade/entry/exit/chart/MT5 counts and IDs have zero loss or unexpected delta while frozen;
   - missing analyses and duplicate analysis trade IDs are both zero; v1 analysis count equals Trade count;
   - exact expected legacy timeframe/trend mapping counts match the rehearsal;
   - every baseline chart file remains readable and its manifest is unchanged;
   - MT5 sentinel canonical ordered analysis JSON is byte-identical except `updatedAt`;
   - API has zero startup migration failures and zero 5xx responses;
   - capture caller, time, and route for every retired-route 404. Any product or repeated caller is unresolved.
5. Any threshold breach is a rollback: stop new API/web, restore the verified PostgreSQL backup, deploy the recorded old API/web images, validate old DB/API behavior, retain evidence, and do **not** delete the Wiki volume.

## Signed decommission

Only after all 30-minute gates pass and the Release Captain signs go, remove the single mount-derived volume by its exact recorded identity:

```bash
docker volume rm <exact-wiki-volume-name>
```

Immediately verify that the database, chart, and Caddy volumes still exist and that the deleted volume is the recorded Wiki mount. Never use `docker compose down -v`, `docker volume prune`, `docker system prune`, or any broad Docker prune during this procedure.

Post-unfreeze writes are normal activity and must be documented separately; baseline IDs must never disappear.
