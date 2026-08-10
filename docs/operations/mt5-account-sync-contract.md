# MT5 account sync contract

## Trust boundary

The API is the only public owner of account credentials and trade data. The MT5 bridge is a private, outbound dependency and must not be exposed through the public reverse proxy. Configure `MT5_BRIDGE_BASE_URL`, `MT5_BRIDGE_TOKEN`, and `MT5_BRIDGE_TIMEOUT_MS` on the API. The bridge token must be distinct from `MT5_SYNC_TOKEN`, stored as a secret, and rotated independently.

The API sends the configured server, decimal account login, decrypted read-only password, the last opaque cursor, `historyFromMsc`, and `historyToMsc` to `POST /sync` with `Authorization: Bearer <MT5_BRIDGE_TOKEN>`. `historyFromMsc` is zero so every account is reconstructed independently from the beginning of the Unix epoch. `historyToMsc` is always 24 hours after the API request time so an uncorrected broker clock cannot hide records whose encoded timestamp appears to be in the future. The bridge uses these exact inclusive history bounds, echoes them with the server and account login, and returns an opaque cursor, raw deal/order facts, account currency, and current balance. The API validates the identity, range, account snapshot, and full response before committing facts.

## Journal redesign invariants

The UI supplies exactly one owned `accountId`; all campaign, statistics, trade, conflict, and image operations are account-scoped by the API. `MT5_SYNC_TOKEN` is injected only at the trusted proxy/API boundary and is never a browser variable.

The configured server text is preserved exactly for bridge requests. A separately stored canonical server identity is used for database matching. Bridge v4 is stateless with respect to users, accounts, and journal Seed values: it logs into the account supplied by each request and returns raw history plus the current account balance, currency, and `currencyDigits`. The API owns the account-scoped balance ledger. It orders persisted deals by `(timeMsc, ticket)`, starts at zero, applies `profit + commission + swap + fee` for every deal, and rounds each delta and running balance with `ROUND_HALF_UP` to the account currency precision before comparing the result with the equally rounded bridge balance. Only a verified ledger produces position-entry assertions and `Trade.seedBalance`; divergence persists its diagnostic state and projects seedless Trades instead of guessing.

Image uploads require a campaign-scoped UUID `uploadId`. Retrying the same key returns the persisted row. Physical flat-root files use an independent globally unique UUID `.webp` filename created with exclusive filesystem writes; logical replay identifiers are never used as paths.
The durable sync lease is claimed before bridge I/O and renewed by an exact `(accountId, leaseId, unexpired)` compare-and-set immediately after bridge I/O. Renewal failure discards the response before persistence; the fenced transaction still requires the same live lease.

Balance events, ledger state, raw MT5 facts, position assertions, and Trade projection are committed in the same fenced transaction. The ledger is keyed by the API account and exact canonical server/login identity, so histories cannot cross users or accounts. Every balance event retains its source Deal ticket, before/delta/after values, currency, and ledger version. Replays rebuild these derived rows from persisted raw Deals, including when a digest cursor suppresses an unchanged Deal stream.
## Consistency and retries

A sync is authorized only while the initiating user owns the active account and the exact lease remains live. Imported facts, projected trades, campaign membership, cursor advancement, and lease completion form one fenced operation. Failed validation, a stale lease, account replacement/deactivation, or persistence failure must not advance the cursor or retain partial output.

Fact identifiers are lossless base-10 integer strings. Cursors are opaque: neither service may parse, normalize, truncate, or reconstruct them. Replaying a cursor and response must be idempotent. Operators may retry transport failures; they must not manually advance a cursor.
## Campaign serialization and historical accounts

Every campaign mutation first locks the owned `mt5_accounts` row and then takes the transaction-scoped advisory lock derived from the canonical server/login identity. This row-then-advisory order is shared by sync, campaign relink, and conflict resolution; callers re-read mutable state after both locks. The lock helper authorizes ownership but is deliberately active-state agnostic: it can return an owned inactive or replaced account.

Locking is not sync eligibility. Sync separately enforces its active-account, exact identity/credential, and live-lease fence after acquiring the shared lock. An inactive or replaced account therefore produces no sync facts, projections, campaign changes, or cursor advancement. Manual relink and conflict-resolution operations retain their existing owned historical scope: they may edit an inactive or replaced account's history, subject to the normal trade, campaign, conflict, ownership, and account-compatibility checks.

Projection is membership-first. When a projected trade already has a membership, sync does not create a campaign or membership and does not move or relabel AUTO or MANUAL intent. Only an unassociated projected trade receives its root campaign and AUTO membership. This makes a valid replay idempotent and prevents replay from creating an empty root campaign.

## Per-stream replay

The bridge computes deal and order digests independently. A response returns the complete serialized deals stream only when its digest changed since the cursor and the complete serialized orders stream only when its digest changed; the unchanged stream is an empty array. The signed opaque cursor always records both current digests. The account snapshot and exact history range are returned on every v4 response. The API accepts deals-only, orders-only, both-stream, and neither-stream replay and rebuilds the balance ledger from persisted raw facts before advancing the cursor.

## Network and response limits

Allow API-to-bridge traffic only. Use TLS outside a single-host private container network. The API timeout is 1,000–30,000 ms and defaults to 10,000 ms. The bridge response limit is 1 MiB. Logs and metrics must never contain passwords, bearer tokens, session cookies, or full bridge payloads.

Monitor sync success/failure counts, latency, stale-fence rejection, and last successful sync age. Treat repeated identity mismatch, invalid payload, or authentication failure as a security incident.
