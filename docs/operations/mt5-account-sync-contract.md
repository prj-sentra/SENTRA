# MT5 account sync contract

## Trust boundary

The API is the only public owner of account credentials and trade data. The MT5 bridge is a private, outbound dependency and must not be exposed through the public reverse proxy. Configure `MT5_BRIDGE_BASE_URL`, `MT5_BRIDGE_TOKEN`, and `MT5_BRIDGE_TIMEOUT_MS` on the API. The bridge token must be distinct from `MT5_SYNC_TOKEN`, stored as a secret, and rotated independently.

The API sends the configured server, decimal account login, decrypted read-only password, and the last opaque cursor to `POST /sync` with `Authorization: Bearer <MT5_BRIDGE_TOKEN>`. The bridge must echo the server and account login, return an opaque cursor, and return complete deal and order facts. The API validates identity and the full response before committing any facts.

## Consistency and retries

A sync is authorized only while the initiating user owns the active account and the exact lease remains live. Imported facts, projected trades, campaign membership, cursor advancement, and lease completion form one fenced operation. Failed validation, a stale lease, account replacement/deactivation, or persistence failure must not advance the cursor or retain partial output.

Fact identifiers are lossless base-10 integer strings. Cursors are opaque: neither service may parse, normalize, truncate, or reconstruct them. Replaying a cursor and response must be idempotent. Operators may retry transport failures; they must not manually advance a cursor.

## Network and response limits

Allow API-to-bridge traffic only. Use TLS outside a single-host private container network. The API timeout is 1,000–30,000 ms and defaults to 10,000 ms. The bridge response limit is 1 MiB. Logs and metrics must never contain passwords, bearer tokens, session cookies, or full bridge payloads.

Monitor sync success/failure counts, latency, stale-fence rejection, and last successful sync age. Treat repeated identity mismatch, invalid payload, or authentication failure as a security incident.
