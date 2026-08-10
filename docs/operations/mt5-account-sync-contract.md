# MT5 account sync contract

## Trust boundary

The API is the only public owner of account credentials and trade data. The MT5 bridge is a private, outbound dependency and must not be exposed through the public reverse proxy. Configure `MT5_BRIDGE_BASE_URL`, `MT5_BRIDGE_TOKEN`, and `MT5_BRIDGE_TIMEOUT_MS` on the API. The bridge token must be distinct from `MT5_SYNC_TOKEN`, stored as a secret, and rotated independently.

The API sends the configured server, decimal account login, decrypted read-only password, and the last opaque cursor to `POST /sync` with `Authorization: Bearer <MT5_BRIDGE_TOKEN>`. The bridge must echo the server and account login, return an opaque cursor, and return complete deal and order facts. The API validates identity and the full response before committing any facts.

## Journal redesign invariants

The UI supplies exactly one owned `accountId`; all campaign, statistics, trade, conflict, and image operations are account-scoped by the API. `MT5_SYNC_TOKEN` is injected only at the trusted proxy/API boundary and is never a browser variable.

The configured server text is preserved exactly for bridge requests. A separately stored trimmed lowercase server identity is used only for matching. Bridge v3 responses contain a complete, disjoint position-entry assertion union: `PROVEN`, anchored unsupported, or unanchored `OPENING_DEAL_OUTSIDE_HISTORY`. Anchors require retained BUY/SELL `IN` raw deals; the API correlates ticket/order/position/time exactly, persists immutable state, and never derives a seed from later account state. Proven balances alone may seed a Trade. Anchored unsupported positions still import and project ordinary seedless Trades; only unanchored positions skip Trade projection.

Image uploads require a campaign-scoped UUID `uploadId`. Retrying the same key returns the persisted row. Physical flat-root files use an independent globally unique UUID `.webp` filename created with exclusive filesystem writes; logical replay identifiers are never used as paths.
The durable sync lease is claimed before bridge I/O and renewed by an exact `(accountId, leaseId, unexpired)` compare-and-set immediately after bridge I/O. Renewal failure discards the response before persistence; the fenced transaction still requires the same live lease.
## Consistency and retries

A sync is authorized only while the initiating user owns the active account and the exact lease remains live. Imported facts, projected trades, campaign membership, cursor advancement, and lease completion form one fenced operation. Failed validation, a stale lease, account replacement/deactivation, or persistence failure must not advance the cursor or retain partial output.

Fact identifiers are lossless base-10 integer strings. Cursors are opaque: neither service may parse, normalize, truncate, or reconstruct them. Replaying a cursor and response must be idempotent. Operators may retry transport failures; they must not manually advance a cursor.
## Campaign serialization and historical accounts

Every campaign mutation first locks the owned `mt5_accounts` row and then takes the transaction-scoped advisory lock derived from the canonical server/login identity. This row-then-advisory order is shared by sync, campaign relink, and conflict resolution; callers re-read mutable state after both locks. The lock helper authorizes ownership but is deliberately active-state agnostic: it can return an owned inactive or replaced account.

Locking is not sync eligibility. Sync separately enforces its active-account, exact identity/credential, and live-lease fence after acquiring the shared lock. An inactive or replaced account therefore produces no sync facts, projections, campaign changes, or cursor advancement. Manual relink and conflict-resolution operations retain their existing owned historical scope: they may edit an inactive or replaced account's history, subject to the normal trade, campaign, conflict, ownership, and account-compatibility checks.

Projection is membership-first. When a projected trade already has a membership, sync does not create a campaign or membership and does not move or relabel AUTO or MANUAL intent. Only an unassociated projected trade receives its root campaign and AUTO membership. This makes a valid replay idempotent and prevents replay from creating an empty root campaign.

## Per-stream replay

The bridge computes deal and order digests independently. A response returns the complete serialized deals stream only when its digest changed since the cursor and the complete serialized orders stream only when its digest changed; the unchanged stream is an empty array. The signed opaque cursor always records both current digests, and the v3 assertion union remains complete for every retained execution position in every response. The API must accept deals-only, orders-only, both-stream, and neither-stream replay without reconstructing or manually advancing the cursor.

## Network and response limits

Allow API-to-bridge traffic only. Use TLS outside a single-host private container network. The API timeout is 1,000–30,000 ms and defaults to 10,000 ms. The bridge response limit is 1 MiB. Logs and metrics must never contain passwords, bearer tokens, session cookies, or full bridge payloads.

Monitor sync success/failure counts, latency, stale-fence rejection, and last successful sync age. Treat repeated identity mismatch, invalid payload, or authentication failure as a security incident.
