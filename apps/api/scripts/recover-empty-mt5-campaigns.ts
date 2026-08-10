import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, type QueryResultRow } from 'pg';

const EXPECTED_COUNT = 39;
const SCRIPT_PATH = __filename;
const LOCK_TABLES = [
  'mt5_accounts', 'trades', 'trade_campaigns', 'campaign_memberships',
  'campaign_conflicts', 'trade_campaign_images', 'trade_analyses',
  'trade_analysis_archives', 'trade_analysis_economic_indicators', 'trade_entries', 'trade_exits',
  'mt5_deals', 'mt5_orders', 'mt5_position_balances', 'mt5_sync_status',
] as const;

export interface RecoveryClient { query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>; }
export interface Candidate {
  id: string; rootTradeId: string; destinationCampaignId: string; membershipId: string;
  ownerId: string; mt5AccountId: string; mt5ServerCanonical: string; mt5AccountLogin: string; mt5PositionId: string; createdAt: string;
}
export interface RecoveryManifest {
  version: 1; expectedCount: number; incidentStart: string; incidentEnd: string; incidentEvidence: Record<string, string>;
  candidates: Candidate[]; scriptSha256: string; querySha256: string; databaseFingerprint: string; baselineSha256: string; protectedSnapshot: QueryResultRow[]; protectedSnapshotSha256: string;
}

const candidateQuery = `
SELECT c.id, c.root_trade_id AS "rootTradeId", m.id AS "membershipId", m.campaign_id AS "destinationCampaignId",
       c.owner_id AS "ownerId", c.mt5_account_id AS "mt5AccountId", t.mt5_server_canonical AS "mt5ServerCanonical",
       t.mt5_account_login::text AS "mt5AccountLogin", t.mt5_position_id::text AS "mt5PositionId", c.created_at AS "createdAt"
FROM trade_campaigns c
JOIN trades t ON t.id = c.root_trade_id
JOIN campaign_memberships m ON m.trade_id = c.root_trade_id
JOIN trade_campaigns d ON d.id = m.campaign_id
WHERE c.id = ANY($1::text[])
  AND NOT EXISTS (SELECT 1 FROM campaign_memberships cm WHERE cm.campaign_id = c.id)
  AND c.created_at >= $2::timestamptz AND c.created_at <= $3::timestamptz
  AND c.owner_id = t.owner_id AND c.mt5_account_id = t.mt5_account_id
  AND c.owner_id = d.owner_id AND c.mt5_account_id = d.mt5_account_id
  AND m.campaign_id <> c.id
  AND t.mt5_account_id IS NOT NULL AND t.mt5_server_canonical IS NOT NULL
  AND t.mt5_account_login IS NOT NULL AND t.mt5_position_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM trade_campaign_images i WHERE i.campaign_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM campaign_conflicts f WHERE f.resolved_campaign_id = c.id
    OR (jsonb_typeof(f.candidate_campaign_ids) = 'array' AND f.candidate_campaign_ids @> jsonb_build_array(c.id)))
ORDER BY c.id`;

function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }

function utc(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) throw new Error(`invalid canonical UTC timestamp: ${value}`);
  return value;
}
function sortedIds(ids: readonly string[]): string[] {
  const sorted = [...ids].sort();
  if (!sorted.length || new Set(sorted).size !== sorted.length) throw new Error('candidate IDs must be nonempty and distinct');
  return sorted;
}
export function scriptSha256(): string { return sha256(readFileSync(SCRIPT_PATH)); }
export function querySha256(): string { return sha256(candidateQuery); }

export async function databaseFingerprint(db: RecoveryClient): Promise<string> {
  const identity = await db.query(`SELECT current_database() AS database, (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid, inet_server_addr()::text AS address, inet_server_port()::text AS port, version() AS version`);
  const migrations = await db.query('SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name');
  return sha256(JSON.stringify({ identity: identity.rows[0], migrations: migrations.rows }));
}
async function protectedSnapshot(db: RecoveryClient, candidateIds: readonly string[], rootTradeIds: readonly string[], accountIds: readonly string[]): Promise<QueryResultRow[]> {
  const result = await db.query(`
    SELECT 'noncandidate_campaign' AS kind, to_jsonb(c) AS row FROM trade_campaigns c WHERE NOT c.id = ANY($1::text[])
    UNION ALL SELECT 'noncandidate_membership', to_jsonb(m) FROM campaign_memberships m WHERE NOT m.campaign_id = ANY($1::text[])
    UNION ALL SELECT 'root_trade', to_jsonb(t) FROM trades t WHERE t.id = ANY($2::text[])
    UNION ALL SELECT 'root_analysis', to_jsonb(a) FROM trade_analyses a WHERE a.trade_id = ANY($2::text[])
    UNION ALL SELECT 'root_analysis_archive', to_jsonb(a) FROM trade_analysis_archives a WHERE a.trade_id = ANY($2::text[])
    UNION ALL SELECT 'root_analysis_indicator', to_jsonb(i) FROM trade_analysis_economic_indicators i JOIN trade_analyses a ON a.id = i.analysis_id WHERE a.trade_id = ANY($2::text[])
    UNION ALL SELECT 'root_entry', to_jsonb(e) FROM trade_entries e WHERE e."tradeId" = ANY($2::text[])
    UNION ALL SELECT 'root_exit', to_jsonb(e) FROM trade_exits e WHERE e."tradeId" = ANY($2::text[])
    UNION ALL SELECT 'conflict', to_jsonb(f) || jsonb_build_object('candidate_campaign_ids_bytes', encode(jsonb_send(f.candidate_campaign_ids), 'hex')) FROM campaign_conflicts f
    UNION ALL SELECT 'image_file_evidence', to_jsonb(i) FROM trade_campaign_images i
    UNION ALL SELECT 'mt5_deal', to_jsonb(d) FROM mt5_deals d WHERE d.account_id = ANY($3::text[])
    UNION ALL SELECT 'mt5_order', to_jsonb(o) FROM mt5_orders o WHERE o.account_id = ANY($3::text[])
    UNION ALL SELECT 'mt5_position_balance', to_jsonb(b) FROM mt5_position_balances b WHERE b.account_id = ANY($3::text[])
    UNION ALL SELECT 'mt5_sync_status', to_jsonb(s) FROM mt5_sync_status s WHERE s.account_id = ANY($3::text[])
    ORDER BY kind, row`, [candidateIds, rootTradeIds, accountIds]);
  return result.rows;
}
function protectedSnapshotSha256(snapshot: readonly QueryResultRow[]): string { return sha256(JSON.stringify(snapshot)); }
async function baselineSha256(db: RecoveryClient): Promise<string> {
  const result = await db.query(`SELECT 'campaigns' AS kind, id FROM trade_campaigns UNION ALL SELECT 'memberships', id FROM campaign_memberships UNION ALL SELECT 'conflicts', id FROM campaign_conflicts UNION ALL SELECT 'images', id FROM trade_campaign_images ORDER BY kind, id`);
  return sha256(JSON.stringify(result.rows));
}

export async function buildManifest(db: RecoveryClient, input: { ids: readonly string[]; incidentStart: string; incidentEnd: string; incidentEvidence: Record<string, string> }): Promise<RecoveryManifest> {
  const ids = sortedIds(input.ids);
  const incidentStart = utc(input.incidentStart); const incidentEnd = utc(input.incidentEnd);
  if (incidentStart > incidentEnd) throw new Error('incident start must not exceed incident end');
  if (ids.length !== EXPECTED_COUNT) throw new Error(`expected exactly ${EXPECTED_COUNT} reviewed IDs`);
  if (Object.keys(input.incidentEvidence).length !== ids.length || ids.some((id) => !input.incidentEvidence[id]?.trim())) throw new Error('each reviewed ID requires nonempty incident evidence');
  const rows = (await db.query<Candidate>(candidateQuery, [ids, incidentStart, incidentEnd])).rows;
  if (rows.length !== ids.length || rows.map((row) => row.id).join(',') !== ids.join(',')) throw new Error('candidate topology, reference, incident, or exact-ID gate failed');
  const rootTradeIds = rows.map((row) => row.rootTradeId);
  const accountIds = [...new Set(rows.map((row) => row.mt5AccountId))].sort();
  const protectedRows = await protectedSnapshot(db, ids, rootTradeIds, accountIds);
  return { version: 1, expectedCount: EXPECTED_COUNT, incidentStart, incidentEnd, incidentEvidence: Object.fromEntries(ids.map((id) => [id, input.incidentEvidence[id]])), candidates: rows, scriptSha256: scriptSha256(), querySha256: querySha256(), databaseFingerprint: await databaseFingerprint(db), baselineSha256: await baselineSha256(db), protectedSnapshot: protectedRows, protectedSnapshotSha256: protectedSnapshotSha256(protectedRows) };
}

export async function verifyManifest(db: RecoveryClient, manifest: RecoveryManifest, expected: { manifestSha256: string; scriptSha256: string; databaseFingerprint: string; incidentStart: string; incidentEnd: string; expectedCount: number }): Promise<void> {
  const text = JSON.stringify(manifest, null, 2) + '\n';
  if (sha256(text) !== expected.manifestSha256) throw new Error('manifest SHA-256 mismatch');
  if (manifest.version !== 1 || manifest.expectedCount !== EXPECTED_COUNT || expected.expectedCount !== EXPECTED_COUNT) throw new Error('expected count gate failed');
  if (manifest.scriptSha256 !== expected.scriptSha256 || manifest.scriptSha256 !== scriptSha256()) throw new Error('script SHA-256 mismatch');
  if (manifest.querySha256 !== querySha256()) throw new Error('query SHA-256 mismatch');
  if (manifest.databaseFingerprint !== expected.databaseFingerprint || manifest.databaseFingerprint !== await databaseFingerprint(db)) throw new Error('database fingerprint mismatch');
  if (manifest.incidentStart !== utc(expected.incidentStart) || manifest.incidentEnd !== utc(expected.incidentEnd)) throw new Error('incident bounds mismatch');
  const ids = sortedIds(manifest.candidates.map((candidate) => candidate.id));
  if (ids.length !== EXPECTED_COUNT || Object.keys(manifest.incidentEvidence).sort().join(',') !== ids.join(',')) throw new Error('manifest candidate/evidence gate failed');
}

export async function applyVerifiedDeletion(db: RecoveryClient, manifest: RecoveryManifest): Promise<string[]> {
  const ids = sortedIds(manifest.candidates.map((candidate) => candidate.id));
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL lock_timeout = '10s'"); await db.query("SET LOCAL statement_timeout = '60s'");
    for (const table of LOCK_TABLES) await db.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
    const rows = (await db.query<Candidate>(candidateQuery, [ids, manifest.incidentStart, manifest.incidentEnd])).rows;
    const rootTradeIds = manifest.candidates.map((row) => row.rootTradeId);
    const accountIds = [...new Set(manifest.candidates.map((row) => row.mt5AccountId))].sort();
    const liveProtectedSnapshot = await protectedSnapshot(db, ids, rootTradeIds, accountIds);
    if (JSON.stringify(rows) !== JSON.stringify(manifest.candidates) || await baselineSha256(db) !== manifest.baselineSha256 || JSON.stringify(liveProtectedSnapshot) !== JSON.stringify(manifest.protectedSnapshot) || protectedSnapshotSha256(liveProtectedSnapshot) !== manifest.protectedSnapshotSha256) throw new Error('locked provenance, baseline, or protected snapshot drift');
    await db.query('SELECT id FROM trade_campaigns WHERE id = ANY($1::text[]) FOR KEY SHARE', [ids]);
    await db.query('SELECT id FROM trades WHERE id = ANY($1::text[]) FOR KEY SHARE', [rootTradeIds]);
    await db.query('SELECT id FROM trade_campaigns WHERE id = ANY($1::text[]) FOR KEY SHARE', [manifest.candidates.map((row) => row.destinationCampaignId)]);
    const deleted = (await db.query<{ id: string }>('DELETE FROM trade_campaigns WHERE id = ANY($1::text[]) RETURNING id', [ids])).rows.map((row) => row.id).sort();
    if (deleted.join(',') !== ids.join(',')) throw new Error('DELETE RETURNING exact-ID mismatch');
    const remain = await db.query('SELECT id FROM trade_campaigns WHERE id = ANY($1::text[])', [ids]);
    if (remain.rows.length) throw new Error('postflight candidate remains');
    const postDeleteProtectedSnapshot = await protectedSnapshot(db, ids, rootTradeIds, accountIds);
    if (JSON.stringify(postDeleteProtectedSnapshot) !== JSON.stringify(manifest.protectedSnapshot) || protectedSnapshotSha256(postDeleteProtectedSnapshot) !== manifest.protectedSnapshotSha256) throw new Error('post-delete protected snapshot drift');
    await db.query('COMMIT'); return deleted;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}

function arg(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
async function main(): Promise<void> {
  const connectionString = process.env.RECOVERY_DATABASE_URL;
  if (!connectionString) throw new Error('RECOVERY_DATABASE_URL is required');
  const client = new Client({ connectionString }); await client.connect();
  try {
    const apply = process.argv.includes('--apply'); const manifestPath = arg('--manifest');
    if (!apply) {
      if (!manifestPath) throw new Error('dry-run requires --manifest output path');
      const ids = JSON.parse(readFileSync(arg('--reviewed-ids') ?? '', 'utf8')) as string[];
      const evidence = JSON.parse(readFileSync(arg('--incident-evidence') ?? '', 'utf8')) as Record<string, string>;
      const manifest = await buildManifest(client, { ids, incidentStart: arg('--incident-start') ?? '', incidentEnd: arg('--incident-end') ?? '', incidentEvidence: evidence });
      writeFileSync(resolve(manifestPath), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }); console.log(`dry-run manifest: ${manifestPath}`); return;
    }
    if (!process.argv.includes('--confirm-delete-empty-mt5-campaigns')) throw new Error('apply requires --confirm-delete-empty-mt5-campaigns');
    if (!manifestPath) throw new Error('apply requires --manifest');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RecoveryManifest;
    await verifyManifest(client, manifest, { manifestSha256: arg('--manifest-sha256') ?? '', scriptSha256: arg('--script-sha256') ?? '', databaseFingerprint: arg('--database-fingerprint') ?? '', incidentStart: arg('--incident-start') ?? '', incidentEnd: arg('--incident-end') ?? '', expectedCount: Number(arg('--expected-count')) });
    console.log(`deleted: ${(await applyVerifiedDeletion(client, manifest)).join(',')}`);
  } finally { await client.end(); }
}
if (require.main === module) void main();
