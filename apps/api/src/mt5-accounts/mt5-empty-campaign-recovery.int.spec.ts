import { createHash } from 'node:crypto';
import { Client, type QueryResultRow } from 'pg';
import { applyVerifiedDeletion, buildManifest, type RecoveryClient, type RecoveryManifest, verifyManifest } from '../../scripts/recover-empty-mt5-campaigns';

class RecoveryDb implements RecoveryClient {
  readonly queries: string[] = [];
  deleted = false;
  drift = false;
  candidates: QueryResultRow[] = [];
  
  private rows<T extends QueryResultRow>(rows: QueryResultRow[]): T[] {
    return rows as unknown as T[];
  }
  
  async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<{ rows: T[] }> {
    this.queries.push(text);
    if (text.startsWith('SELECT current_database')) return { rows: this.rows<T>([{ database: 'test', oid: '1', address: '127.0.0.1', port: '5432', version: 'PostgreSQL test' }]) };
    if (text.includes('_prisma_migrations')) return { rows: this.rows<T>([{ migration_name: 'one', checksum: 'checksum' }]) };
    if (text.startsWith("SELECT 'campaigns'")) return { rows: this.rows<T>(this.drift ? [{ kind: 'campaigns', id: 'drift' }] : []) };
    if (text.includes('JOIN campaign_memberships m ON m.trade_id')) return { rows: this.rows<T>(this.candidates) };
    if (text.startsWith('DELETE')) { this.deleted = true; return { rows: this.rows<T>(this.candidates.map(({ id }) => ({ id }))) }; }
    return { rows: [] as T[] };
  }
}

describe('empty MT5 campaign recovery gates', () => {
  const ids = Array.from({ length: 39 }, (_, index) => `id-${String(index).padStart(2, '0')}`);
  const evidence = Object.fromEntries(ids.map((id) => [id, 'incident evidence']));

  it('rejects invalid topology instead of generating a manifest', async () => {
    await expect(buildManifest(new RecoveryDb(), { ids, incidentStart: '2026-08-01T00:00:00.000Z', incidentEnd: '2026-08-02T00:00:00.000Z', incidentEvidence: evidence })).rejects.toThrow('candidate topology');
  });
  it('rejects a candidate set whose reviewed count is not exactly 39', async () => {
    await expect(buildManifest(new RecoveryDb(), { ids: ids.slice(1), incidentStart: '2026-08-01T00:00:00.000Z', incidentEnd: '2026-08-02T00:00:00.000Z', incidentEvidence: Object.fromEntries(ids.slice(1).map((id) => [id, 'incident evidence'])) })).rejects.toThrow('expected exactly 39');
  });

  it('rejects a conflict/reference candidate instead of allowing DELETE', async () => {
    await expect(buildManifest(new RecoveryDb(), { ids, incidentStart: '2026-08-01T00:00:00.000Z', incidentEnd: '2026-08-02T00:00:00.000Z', incidentEvidence: evidence })).rejects.toThrow('candidate topology');
  });

  it('rejects a manifest with a bad hash before deletion', async () => {
    const db = new RecoveryDb();
    const manifest = { version: 1, expectedCount: 39, incidentStart: '2026-08-01T00:00:00.000Z', incidentEnd: '2026-08-02T00:00:00.000Z', incidentEvidence: evidence, candidates: ids.map((id) => ({ id, rootTradeId: `root-${id}`, destinationCampaignId: `destination-${id}`, membershipId: `member-${id}`, ownerId: 'owner', mt5AccountId: 'account', mt5ServerCanonical: 'server', mt5AccountLogin: '1', mt5PositionId: '1', createdAt: '2026-08-01T00:00:00.000Z' })), scriptSha256: 'bad', querySha256: 'bad', databaseFingerprint: 'bad', baselineSha256: createHash('sha256').update('[]').digest('hex'), protectedSnapshot: [], protectedSnapshotSha256: createHash('sha256').update('[]').digest('hex') } as RecoveryManifest;
    await expect(verifyManifest(db, manifest, { manifestSha256: 'bad', scriptSha256: 'bad', databaseFingerprint: 'bad', incidentStart: manifest.incidentStart, incidentEnd: manifest.incidentEnd, expectedCount: 39 })).rejects.toThrow();
    expect(db.deleted).toBe(false);
  });
  it('deletes exactly the reviewed 39 IDs after locked revalidation', async () => {
    const db = new RecoveryDb();
    const candidates = ids.map((id) => ({ id, rootTradeId: `root-${id}`, destinationCampaignId: `destination-${id}`, membershipId: `member-${id}`, ownerId: 'owner', mt5AccountId: 'account', mt5ServerCanonical: 'server', mt5AccountLogin: '1', mt5PositionId: '1', createdAt: '2026-08-01T00:00:00.000Z' }));
    db.candidates = candidates;
    const manifest = { version: 1, expectedCount: 39, incidentStart: '2026-08-01T00:00:00.000Z', incidentEnd: '2026-08-02T00:00:00.000Z', incidentEvidence: evidence, candidates, scriptSha256: 'x', querySha256: 'x', databaseFingerprint: 'x', baselineSha256: createHash('sha256').update('[]').digest('hex'), protectedSnapshot: [], protectedSnapshotSha256: createHash('sha256').update('[]').digest('hex') } as RecoveryManifest;
    await expect(applyVerifiedDeletion(db, manifest)).resolves.toEqual(ids);
    expect(db.deleted).toBe(true);
    expect(db.queries).toContain('COMMIT');
  });

  it('rolls back on locked topology drift before DELETE', async () => {
    const db = new RecoveryDb();
    const manifest = { version: 1, expectedCount: 39, incidentStart: '2026-08-01T00:00:00.000Z', incidentEnd: '2026-08-02T00:00:00.000Z', incidentEvidence: evidence, candidates: ids.map((id) => ({ id, rootTradeId: `root-${id}`, destinationCampaignId: `destination-${id}`, membershipId: `member-${id}`, ownerId: 'owner', mt5AccountId: 'account', mt5ServerCanonical: 'server', mt5AccountLogin: '1', mt5PositionId: '1', createdAt: '2026-08-01T00:00:00.000Z' })), scriptSha256: 'x', querySha256: 'x', databaseFingerprint: 'x', baselineSha256: createHash('sha256').update('[]').digest('hex'), protectedSnapshot: [], protectedSnapshotSha256: createHash('sha256').update('[]').digest('hex') } as RecoveryManifest;
    db.drift = true;
    await expect(applyVerifiedDeletion(db, manifest)).rejects.toThrow('locked provenance, baseline, or protected snapshot drift');
    expect(db.deleted).toBe(false);
    expect(db.queries).toContain('ROLLBACK');
  });
});

describe('empty MT5 campaign recovery on disposable PostgreSQL', () => {
  const url = process.env.TEST_DATABASE_URL;
  const run = url ? it : it.skip;
  const incidentStart = '2026-08-01T00:00:00.000Z';
  const incidentEnd = '2026-08-02T00:00:00.000Z';
  let db: Client;
  let schema: string;

  async function execute(sql: string): Promise<void> { await db.query(sql); }
  async function countCandidates(ids: readonly string[]): Promise<number> {
    return Number((await db.query('SELECT count(*)::int AS count FROM trade_campaigns WHERE id = ANY($1::text[])', [ids])).rows[0].count);
  }
  async function seed(): Promise<{ ids: string[]; evidence: Record<string, string> }> {
    const ids = Array.from({ length: 39 }, (_, index) => `recovery-${String(index).padStart(2, '0')}`);
    const evidence = Object.fromEntries(ids.map((id) => [id, 'disposable incident evidence']));
    await db.query(`INSERT INTO mt5_accounts (id) VALUES ('account')`);
    await db.query(`INSERT INTO trade_campaigns (id, root_trade_id, owner_id, mt5_account_id, created_at) VALUES ('destination', 'destination-root', 'owner', 'account', $1)`, [incidentStart]);
    await db.query(`INSERT INTO trades (id, owner_id, mt5_account_id, mt5_server_canonical, mt5_account_login, mt5_position_id, note) VALUES ('destination-root', 'owner', 'account', 'server', 1, 999, 'protected')`);
    await db.query(`INSERT INTO campaign_memberships (id, campaign_id, trade_id) VALUES ('destination-member', 'destination', 'destination-root')`);
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      await db.query(`INSERT INTO trades (id, owner_id, mt5_account_id, mt5_server_canonical, mt5_account_login, mt5_position_id, note) VALUES ($1, 'owner', 'account', 'server', 1, $2, 'protected root')`, [`root-${id}`, index]);
      await db.query(`INSERT INTO trade_campaigns (id, root_trade_id, owner_id, mt5_account_id, created_at) VALUES ($1, $2, 'owner', 'account', $3)`, [id, `root-${id}`, incidentStart]);
      await db.query(`INSERT INTO campaign_memberships (id, campaign_id, trade_id) VALUES ($1, 'destination', $2)`, [`member-${id}`, `root-${id}`]);
      await db.query(`INSERT INTO trade_analyses (id, trade_id, note) VALUES ($1, $2, 'authored')`, [`analysis-${id}`, `root-${id}`]);
      await db.query(`INSERT INTO trade_entries (id, "tradeId", note) VALUES ($1, $2, 'entry')`, [`entry-${id}`, `root-${id}`]);
      await db.query(`INSERT INTO trade_exits (id, "tradeId", note) VALUES ($1, $2, 'exit')`, [`exit-${id}`, `root-${id}`]);
    }
    return { ids, evidence };
  }

  beforeEach(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    const name = (await db.query<{ database: string }>('SELECT current_database() AS database')).rows[0].database;
    if (!/(^|[_-])(test|testing|ci|spec)([_-]|$)/i.test(name)) throw new Error(`refusing recovery integration database: ${name}`);
    schema = `recovery_spec_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    await execute(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    await execute(`
      CREATE TABLE _prisma_migrations (migration_name text, checksum text);
      CREATE TABLE mt5_accounts (id text PRIMARY KEY);
      CREATE TABLE trades (id text PRIMARY KEY, owner_id text NOT NULL, mt5_account_id text, mt5_server_canonical text, mt5_account_login bigint, mt5_position_id bigint, note text);
      CREATE TABLE trade_campaigns (id text PRIMARY KEY, root_trade_id text NOT NULL UNIQUE, owner_id text NOT NULL, mt5_account_id text, created_at timestamptz NOT NULL);
      CREATE TABLE campaign_memberships (id text PRIMARY KEY, campaign_id text NOT NULL, trade_id text NOT NULL UNIQUE);
      CREATE TABLE campaign_conflicts (id text PRIMARY KEY, resolved_campaign_id text, candidate_campaign_ids jsonb NOT NULL DEFAULT '[]');
      CREATE TABLE trade_campaign_images (id text PRIMARY KEY, campaign_id text NOT NULL, file_name text, content_sha256 text);
      CREATE TABLE trade_analyses (id text PRIMARY KEY, trade_id text NOT NULL, note text);
      CREATE TABLE trade_analysis_archives (id text PRIMARY KEY, trade_id text NOT NULL, content text);
      CREATE TABLE trade_analysis_economic_indicators (id text PRIMARY KEY, analysis_id text NOT NULL);
      CREATE TABLE trade_entries (id text PRIMARY KEY, "tradeId" text NOT NULL, note text);
      CREATE TABLE trade_exits (id text PRIMARY KEY, "tradeId" text NOT NULL, note text);
      CREATE TABLE mt5_deals (id text PRIMARY KEY, account_id text NOT NULL);
      CREATE TABLE mt5_orders (id text PRIMARY KEY, account_id text NOT NULL);
      CREATE TABLE mt5_position_balances (id text PRIMARY KEY, account_id text NOT NULL);
      CREATE TABLE mt5_sync_status (id text PRIMARY KEY, account_id text NOT NULL);
    `);
  });
  afterEach(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });

  run('enforces JSON conflict references and successfully applies exactly 39 protected candidates', async () => {
    const { ids, evidence } = await seed();
    await db.query(`INSERT INTO campaign_conflicts (id, resolved_campaign_id) VALUES ('resolved-reference', $1)`, [ids[0]]);
    await expect(buildManifest(db, { ids, incidentStart, incidentEnd, incidentEvidence: evidence })).rejects.toThrow('candidate topology');
    await db.query(`DELETE FROM campaign_conflicts WHERE id = 'resolved-reference'`);
    await db.query(`INSERT INTO campaign_conflicts (id, candidate_campaign_ids) VALUES ('json-reference', jsonb_build_array($1::text))`, [ids[0]]);
    await expect(buildManifest(db, { ids, incidentStart, incidentEnd, incidentEvidence: evidence })).rejects.toThrow('candidate topology');
    await db.query(`DELETE FROM campaign_conflicts WHERE id = 'json-reference'`);
    const manifest = await buildManifest(db, { ids, incidentStart, incidentEnd, incidentEvidence: evidence });
    await expect(applyVerifiedDeletion(db, manifest)).resolves.toEqual(ids);
    expect(await countCandidates(ids)).toBe(0);
    expect((await db.query(`SELECT note FROM trade_analyses WHERE id = 'analysis-recovery-00'`)).rows[0].note).toBe('authored');
  });

  run('rolls back exact deletion when a protected row changes after DELETE', async () => {
    const { ids, evidence } = await seed();
    const manifest = await buildManifest(db, { ids, incidentStart, incidentEnd, incidentEvidence: evidence });
    await execute(`CREATE FUNCTION mutate_protected_root() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE trades SET note = 'drift' WHERE id = 'root-recovery-00'; RETURN OLD; END $$; CREATE TRIGGER recovery_drift AFTER DELETE ON trade_campaigns FOR EACH ROW EXECUTE FUNCTION mutate_protected_root();`);
    await expect(applyVerifiedDeletion(db, manifest)).rejects.toThrow('post-delete protected snapshot drift');
    expect(await countCandidates(ids)).toBe(39);
    expect((await db.query(`SELECT note FROM trades WHERE id = 'root-recovery-00'`)).rows[0].note).toBe('protected root');
  });
});
