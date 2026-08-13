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

Ledger reconstruction is independent of that request window: every page rebuilds from all raw Deals persisted for the account, records epoch as the ledger coverage start, and verifies the result against the bridge account snapshot. A genuine mismatch records a diverged ledger for investigation but preserves previously proven position-entry balances and Trade seed balances; unverified data must never erase proven data.

Campaign classification is account-scoped and requires both matching trade direction and holding-time connectivity. Each projected MT5 position is the closed interval `[openedAt, closedAt]`; an open position ends at positive infinity. Positions are processed by first opening execution time, opening ticket, then position ID. A new position joins the earliest same-direction campaign containing a position that is open at its opening instant; touching endpoints overlap, and overlap is transitive. If no same-direction position is open, a new campaign starts. Normal synchronization never moves an existing MANUAL membership and never rewrites an already-authored automatic campaign as historical cleanup. Operator reclassification may split historical mixed-direction campaigns and merge historical AUTO campaigns under an account lock after a restore-tested backup: it retains the earliest root, moves images, combines memo text, archives every losing campaign analysis/review payload under `campaign-merge:<campaignId>`, rewrites conflict references, and deletes only emptied campaigns. MANUAL memberships remain fixed except where a mixed-direction historical campaign must be split.

### Safe full synchronization

`POST /mt5-accounts/:id/full-sync` starts or resumes a fixed-snapshot bootstrap without deleting the live journal first. Every Deal and Order observed by that rebuild receives the rebuild fetch timestamp. Only after the final page and account identity checks succeed does one account-locked transaction remove raw facts not observed since `rebuildStartedAt`, reconstruct the balance ledger, and project every surviving position. A failed or interrupted rebuild leaves the prior raw facts, trades, analyses, campaigns, images, and sync watermark usable; the persisted rebuild cursor resumes the same snapshot.

Projection keeps the existing `Trade.id` for the canonical server, account login, and MT5 position ID. It updates MT5-owned execution fields but never replaces trade analysis, entry/exit notes, campaign analysis, memo, images, manual memberships, or manual heads. A previously projected position absent from the completed rebuild is retained and marked with `mt5_source_missing_at`; it is not deleted. Existing campaign membership is also retained during full synchronization.

Classification changes are a separate operation. `GET /mt5-accounts/:id/classification-preview` calculates counts for the current algorithm without mutation. `POST /mt5-accounts/:id/reclassify` applies the reviewed proposal under the account lock. Authored automatic campaigns and manual memberships become explicit conflicts unless a direction split is required to restore the campaign invariant.

### Manual campaign heads

Campaign boundaries have an explicit source. `AUTO` heads come from interval
connectivity, so a real time gap starts a campaign. `MANUAL` heads are
user-defined boundaries that synchronization and reclassification must not
cross. Projection, display, and head mutations use first opening execution
time, opening ticket, then position ID as their deterministic order.

Marking a non-head trade as a manual head atomically moves that trade and every
later member into the affected range, then reapplies interval connectivity
inside that range. The selected connected component starts with a `MANUAL`
head; any later disconnected component starts its own `AUTO` campaign. Only a
non-account-first `MANUAL` head can be unset. Removing it reapplies automatic
interval rules: connected intervals merge into the preceding campaign, while a
real gap retains or creates an `AUTO` head. Connected merges archive the complete analysis
and review graph including indicators and prior archives, append memo content,
move images, and rewrite conflict references before deleting the losing
campaign.

Head mutations acquire the shared account lock, lock campaign and membership
rows, and require `campaignVersion`. Every membership or root change advances
all affected surviving campaign versions, so stale confirmations fail with
HTTP 409. Deployment applies the additive campaign-head migration before API
startup. Verify the `head_source` and campaign `version` columns, run the
disposable PostgreSQL campaign serialization suite, and validate split/unset
controls in the deployed journal.

Concurrent calls return `{ state: 'in_progress', accountId, progress? }`. `progress` contains the durable mode, snapshot, and current page cursor when available. The UI may poll the same authenticated sync route while this state is returned; it must cancel polling on account changes and unmount.

## Limits and operations

Bridge responses are limited to 1 MiB before JSON processing. The API timeout is 1,000–30,000 ms (10,000 ms default). Do not log passwords, bearer tokens, cookies, or full bridge payloads. Treat repeated identity mismatch, invalid response, or bridge authentication failures as security incidents.
