# MT5 account sync contract v5

## Trust boundary

The API alone owns MT5 credentials and journal data. The private bridge is called at `POST /sync` with `Authorization: Bearer <MT5_BRIDGE_TOKEN>`; it is never exposed through the public proxy. `MT5_BRIDGE_TOKEN` and trusted-route `MT5_SYNC_TOKEN` are separate secrets and neither is browser-visible.

The API request is:

```ts
{
  contractVersion: 5,
  server: string,                 // exact configured server text
  accountLogin: number,
  password: string,
  mode: 'bootstrap' | 'incremental',
  snapshotToMsc: number,
  pageCursor?: string,
  changedSinceMsc?: number,       // incremental only
  openPositionIds?: string[]      // incremental only
}
```

The bridge response must echo the exact identity, mode, and `snapshotToMsc`:

```ts
{
  contractVersion: 5,
  server: string,
  accountLogin: number,
  mode: 'bootstrap' | 'incremental',
  snapshotToMsc: number,
  page: { hasMore: boolean, nextCursor?: string, bytes: number },
  account: { currency: string, currencyDigits: number, currentBalance: string },
  deals: DealFact[],
  orders: OrderFact[]
}
```

`page.nextCursor` is required and non-empty only when `hasMore` is true. Cursors are opaque. v4 stream digests and digest cursors are not part of this contract.

## Durable pagination and consistency

A first sync is a bootstrap with a fixed snapshot. Every page is validated, stored idempotently, and then advances the durable page cursor in the same fenced transaction. The lease is renewed after each bridge call and the transaction rechecks active ownership, exact account identity, credential version/ciphertext, and the live lease. A failed request leaves the persisted cursor at the last committed page so a retry resumes safely.

Bootstrap balance-ledger reconstruction and trade/campaign projection are deliberately deferred until the final page, so incomplete historical imports are never published as complete journal state. Incremental pages rebuild the ledger and project only positions changed on that committed page; this allows a position split across response pages to be updated without retaining an unbounded changed-position set. Only the final incremental page clears pagination state and advances `lastSuccessfulSnapshotMsc`. No partial page can advance the successful watermark.

An incremental sync uses `lastSuccessfulSnapshotMsc - 72 hours` as `changedSinceMsc` and obtains `openPositionIds` from persisted OPEN trades for that account. Its snapshot is fixed across all pages. Its watermark advances only in the final fenced transaction. Bootstrap ledger verification starts at millisecond zero; incremental ledger results may be diverged because the request is intentionally overlapping rather than full-history.

Concurrent calls return `{ state: 'in_progress', accountId, progress? }`. `progress` contains the durable mode, snapshot, and current page cursor when available. The UI may poll the same authenticated sync route while this state is returned; it must cancel polling on account changes and unmount.

## Limits and operations

Bridge responses are limited to 1 MiB before JSON processing. The API timeout is 1,000–30,000 ms (10,000 ms default). Do not log passwords, bearer tokens, cookies, or full bridge payloads. Treat repeated identity mismatch, invalid response, or bridge authentication failures as security incidents.
