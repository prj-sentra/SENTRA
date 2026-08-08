import { ConflictException } from '@nestjs/common';
import { Client, Pool, type PoolClient } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = join(__dirname, '..');
const migrationsDirectory = join(root, 'prisma', 'migrations');
const tradeAnalysisMigration = '20260807000000_replace_wiki_journal_with_trade_analysis';
const campaignMigration = '20260808000000_add_trade_campaigns';
const fixturePath = join(__dirname, 'fixtures', 'trade-analysis-migration.sql');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function testDatabaseName(): string {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const name = `trade_analysis_migration_${suffix}`;
  assert(/^[a-z][a-z0-9_]{0,62}$/.test(name), `unsafe generated database name: ${name}`);
  return name;
}

function databaseUrl(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  assert(url.protocol === 'postgres:' || url.protocol === 'postgresql:', 'admin URL must be PostgreSQL');
  url.pathname = `/${database}`;
  return url.toString();
}

async function applySql(client: Client | PoolClient, path: string): Promise<void> {
  const sql = await readFile(path, 'utf8');
  console.log(`${path}: ${createHash('sha256').update(sql).digest('hex')}`);
  await client.query(sql);
}

async function applyPoolSql(pool: Pool, path: string): Promise<void> {
  const client = await pool.connect();
  try {
    await applySql(client, path);
  } finally {
    client.release();
  }
}

async function mustReject(pool: Pool, sql: string, label: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
    if (code.startsWith('23') || code === 'P0001') return;
    throw new Error(`${label} failed for an unexpected reason (SQLSTATE ${code || 'unknown'})`, { cause: error });
  } finally {
    client.release();
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function verifyMigration(pool: Pool): Promise<void> {
  const scalar = async (sql: string) => Number((await pool.query<{ count: string }>(sql)).rows[0]?.count ?? 0);
  assert(await scalar('SELECT count(*) FROM "trades"') === 3, 'fixture trade count changed');
  assert(await scalar('SELECT count(*) FROM "trade_analyses"') === 3, 'every fixture trade must receive one analysis');
  assert(await scalar('SELECT count(*) FROM "trade_analyses" GROUP BY "trade_id" HAVING count(*) <> 1') === 0, 'duplicate analyses exist');
  assert(await scalar('SELECT count(*) FROM "trades" t LEFT JOIN "trade_analyses" a ON a."trade_id" = t.id WHERE a.id IS NULL') === 0, 'trade without analysis exists');
  assert(await scalar('SELECT count(*) FROM "trade_analyses" WHERE "schema_version" <> 1') === 0, 'backfilled analysis schema version must be 1');
  assert(await scalar(`
    SELECT count(*) FROM "trade_analyses" a
    WHERE
      (a."trade_id" = 'legacy-blank' AND (a."base_timeframe" IS NOT NULL OR a."primary_trend" IS NOT NULL))
      OR a."bollinger_band_count" IS NOT NULL OR a."bollinger_direction" IS NOT NULL OR
      a."ma_arrangement" IS NOT NULL OR a."cross" IS NOT NULL OR a."stop_loss_line" IS NOT NULL OR
      a."market_zone_enabled" OR a."market_zone_high" IS NOT NULL OR a."market_zone_low" IS NOT NULL OR
      a."chart_pattern_observed" OR a."chart_pattern_timeframe" IS NOT NULL OR a."chart_pattern_type" IS NOT NULL OR
      a."retail_position_enabled" OR a."retail_buy_average_price" IS NOT NULL OR
      a."retail_sell_average_price" IS NOT NULL OR a."retail_buy_ratio" IS NOT NULL OR
      a."fibonacci_enabled" OR a."fibonacci_start_price" IS NOT NULL OR
      a."fibonacci_end_price" IS NOT NULL OR a."regret" IS NOT NULL
  `) === 0, 'legacy analyses must contain only exact timeframe/trend mappings and empty defaults');
  assert(await scalar('SELECT count(*) FROM "trade_analysis_economic_indicators"') === 0, 'legacy analyses must not receive indicators');

  const mappings = await pool.query<{ id: string; base_timeframe: string | null; primary_trend: string | null }>('SELECT t.id, a.base_timeframe, a.primary_trend::text FROM "trades" t JOIN "trade_analyses" a ON a.trade_id = t.id ORDER BY t.id');
  const expected = new Map([['legacy-exact', ['H1', 'up']], ['legacy-blank', [null, null]], ['legacy-mt5', ['M15', 'sideways']]]);
  for (const row of mappings.rows) {
    const value = expected.get(row.id);
    assert(value?.[0] === row.base_timeframe && value?.[1] === row.primary_trend, `incorrect exact backfill for ${row.id}`);
  }
  const retained = await pool.query<{ id: string; strategy: string | null; thesis: string | null; note: string | null; symbol: string; side: string; status: string }>(
    'SELECT id, strategy, thesis, note, symbol, side::text, status::text FROM "trades" WHERE id = $1',
    ['legacy-exact'],
  );
  assert(
    JSON.stringify(retained.rows[0]) === JSON.stringify({
      id: 'legacy-exact',
      strategy: 'breakout',
      thesis: 'retain prose',
      note: 'retained note',
      symbol: 'EURUSD',
      side: 'long',
      status: 'closed',
    }),
    'retained trade values changed',
  );
  const retainedExecution = await pool.query<{ price: string; quantity: string; reason: string | null }>(
    'SELECT e.price::text, e.quantity::text, x.reason::text FROM "trade_entries" e JOIN "trade_exits" x ON x."tradeId" = e."tradeId" WHERE e."tradeId" = $1',
    ['legacy-exact'],
  );
  assert(
    Number(retainedExecution.rows[0]?.price) === 1.1 &&
      Number(retainedExecution.rows[0]?.quantity) === 1 &&
      retainedExecution.rows[0]?.reason === 'target',
    'retained entry or exit values changed',
  );
  const retainedChart = await pool.query<{
    id: string;
    trade_id: string;
    file_name: string;
    byte_size: number;
    original_name: string | null;
  }>('SELECT id, trade_id, file_name, byte_size, original_name FROM "trade_chart_images" WHERE id = $1', ['chart-exact']);
  assert(
    JSON.stringify(retainedChart.rows[0]) === JSON.stringify({
      id: 'chart-exact',
      trade_id: 'legacy-exact',
      file_name: 'chart.png',
      byte_size: 12,
      original_name: 'chart.png',
    }),
    'retained chart row changed',
  );
  const retainedDeal = await pool.query<{
    server: string;
    account_login: string;
    ticket: string;
    position_id: string;
    symbol: string;
    external_id: string;
    raw_json: { fixture?: boolean };
  }>('SELECT server, account_login::text, ticket::text, position_id::text, symbol, external_id, raw_json FROM "mt5_deals" WHERE server = $1 AND account_login = 1 AND ticket = 10', ['fixture-server']);
  assert(
    JSON.stringify(retainedDeal.rows[0]) === JSON.stringify({
      server: 'fixture-server',
      account_login: '1',
      ticket: '10',
      position_id: '12',
      symbol: 'XAUUSD',
      external_id: 'deal-10',
      raw_json: { fixture: true },
    }),
    'retained MT5 deal row changed',
  );
  const retainedOrder = await pool.query<{
    server: string;
    account_login: string;
    ticket: string;
    position_id: string;
    symbol: string;
    external_id: string;
    raw_json: { fixture?: boolean };
  }>('SELECT server, account_login::text, ticket::text, position_id::text, symbol, external_id, raw_json FROM "mt5_orders" WHERE server = $1 AND account_login = 1 AND ticket = 11', ['fixture-server']);
  assert(
    JSON.stringify(retainedOrder.rows[0]) === JSON.stringify({
      server: 'fixture-server',
      account_login: '1',
      ticket: '11',
      position_id: '12',
      symbol: 'XAUUSD',
      external_id: 'order-11',
      raw_json: { fixture: true },
    }),
    'retained MT5 order row changed',
  );
  const legacyColumns = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'trades'
       AND column_name IN ('timeframe', 'primary_trend', 'journal', 'resultLabelTagId', 'initial_trade_id')`,
  );
  assert(legacyColumns.rows.length === 0, 'legacy trade-analysis columns remain');
  const legacyTables = await pool.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (
      'trade_setup_tag_links', 'trade_rule_violation_tag_links', 'trade_lesson_tag_links',
      'setup_tag_definitions', 'rule_violation_tag_definitions',
      'lesson_tag_definitions', 'result_label_tag_definitions'
    )
  `);
  assert(legacyTables.rows.length === 0, 'legacy journal/tag tables remain');
  const legacyTypes = await pool.query<{ typname: string }>(`
    SELECT typname FROM pg_type
    WHERE typname = 'TradeTagField' AND typnamespace = 'public'::regnamespace
  `);
  assert(legacyTypes.rows.length === 0, 'legacy TradeTagField type remains');

  assert(await scalar('SELECT count(*) FROM "trade_campaigns"') === 2, 'representable legacy roots must become campaigns');
  assert(await scalar(`SELECT count(*) FROM "campaign_memberships" WHERE source::text = 'manual'`) === 2, 'legacy linked root and child must remain MANUAL');
  assert(await scalar(`SELECT count(*) FROM "campaign_memberships" WHERE source::text = 'auto'`) === 1, 'standalone legacy trades must remain eligible for automatic inference');
  assert(await scalar(`
    SELECT count(*) FROM "campaign_memberships" GROUP BY "trade_id" HAVING count(*) <> 1
  `) === 0, 'campaign membership must be unique per trade');
  await mustReject(pool, `
    INSERT INTO "campaign_memberships" (id, "trade_id", "campaign_id", source, "created_at", "updated_at")
    SELECT 'duplicate-' || id, "trade_id", "campaign_id", 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "campaign_memberships" LIMIT 1
  `, 'duplicate campaign membership');
  assert(await scalar(`
    SELECT count(*) FROM "campaign_conflicts"
    WHERE jsonb_typeof("candidate_campaign_ids") <> 'array'
  `) === 0, 'campaign conflict candidates must be arrays');
}

async function verifyProductionPatch(pool: Pool, databaseUrlValue: string): Promise<void> {
  process.env.DATABASE_URL = databaseUrlValue;
  const { PrismaService } = await import('../src/prisma/prisma.service');
  const { TradeLogService } = await import('../src/trade-log/trade-log.service');
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await prisma.tradeAnalysis.update({ where: { tradeId: 'legacy-exact' }, data: { economicIndicators: { create: [{ type: 'CPI', impact: 'POSITIVE', position: 0 }, { type: 'NFP', impact: 'NEGATIVE', position: 1 }] } } });
    const before = await prisma.tradeAnalysis.findUniqueOrThrow({ where: { tradeId: 'legacy-exact' }, include: { economicIndicators: { orderBy: { position: 'asc' } } } });
    const service = new TradeLogService(prisma);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM "trade_analyses" WHERE "trade_id" = $1 FOR UPDATE', ['legacy-exact']);
      const token = before.updatedAt.toISOString();
      const first = service.patchTradeAnalysis('legacy-exact', { expectedUpdatedAt: token, baseTimeframe: 'M5', economicIndicators: [{ type: 'GDP', impact: 'positive' }] });
      const second = service.patchTradeAnalysis('legacy-exact', { expectedUpdatedAt: token, baseTimeframe: 'H4', economicIndicators: [{ type: 'FOMC', impact: 'negative' }] });
      await new Promise((resolve) => setTimeout(resolve, 75));
      const waiters = await pool.query<{ count: string }>(`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
      assert(Number(waiters.rows[0].count) >= 2, 'both production PATCH callers must queue behind the external row lock');
      await holder.query('COMMIT');
      const settled = await Promise.allSettled([first, second]);
      const winners = settled.filter((result): result is Extract<(typeof settled)[number], { status: 'fulfilled' }> => result.status === 'fulfilled');
      const losers = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      assert(winners.length === 1 && losers.length === 1, 'concurrent PATCH must have exactly one winner and one loser');
      assert(losers[0].reason instanceof ConflictException && losers[0].reason.getStatus() === 409, 'loser must be real ConflictException 409');
      const after = await prisma.tradeAnalysis.findUniqueOrThrow({ where: { tradeId: 'legacy-exact' }, include: { economicIndicators: { orderBy: { position: 'asc' } } } });
      assert(after.updatedAt.getTime() !== before.updatedAt.getTime(), 'winner did not update timestamp');
      const indicator = after.economicIndicators[0];
      assert(after.economicIndicators.length === 1 && (indicator.type === 'GDP' || indicator.type === 'FOMC') && indicator.position === 0, 'loser left partial indicators');
      assert((after.baseTimeframe === 'M5' && indicator.type === 'GDP') || (after.baseTimeframe === 'H4' && indicator.type === 'FOMC'), 'final analysis is mixed between callers');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyMt5Sync(databaseUrlValue: string): Promise<void> {
  process.env.DATABASE_URL = databaseUrlValue;
  const priorBaseUrl = process.env.MT5_BRIDGE_BASE_URL;
  const priorToken = process.env.MT5_BRIDGE_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.MT5_BRIDGE_BASE_URL = 'http://mt5-harness';
  process.env.MT5_BRIDGE_TOKEN = 'harness-token';
  const { PrismaService } = await import('../src/prisma/prisma.service');
  const { TradeLogService } = await import('../src/trade-log/trade-log.service');
  const prisma = new PrismaService();
  const deal = (ticket: string, volume: string, price: string, timeMsc: string) => ({
    ticket, order: '90071992547409930', position_id: '99001', time: '1767225600',
    time_msc: timeMsc, type: 0, entry: 0, magic: '0', reason: 0, volume, price,
    commission: '0', swap: '0', profit: '0', fee: '0', symbol: 'XAUUSD',
    comment: '', external_id: `deal-${ticket}`,
  });
  const deals = [
    deal('90071992547409931', '0.4', '100', '1767225600000'),
    deal('90071992547409932', '0.6', '102', '1767225601000'),
  ];
  const orders = [{
    ticket: '90071992547409930', position_id: '99001',
    time_setup: '1767225599', time_setup_msc: '1767225599000',
    time_done: '1767225602', time_done_msc: '1767225602000',
    type: 0, state: 4, reason: 0, volume_initial: '1', volume_current: '0',
    price_open: '101.2', sl: '95', tp: '110', price_current: '101.2',
    price_stoplimit: '0', symbol: 'XAUUSD', comment: '', external_id: 'order-90071992547409930',
  }];
  const response = (body: unknown): Response => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/health')) return response({ account: { login: 777, server: 'harness' }, initial_from: '2026-01-01T00:00:00.000Z' });
    if (url.endsWith('/api/history/deals')) return response({ deals });
    if (url.endsWith('/api/history/orders')) return response({ orders });
    return new Response('', { status: 404 });
  };
  await prisma.$connect();
  try {
    const service = new TradeLogService(prisma);
    const concurrent = await Promise.all([service.syncMt5Trades(), service.syncMt5Trades()]);
    assert(concurrent.reduce((sum, result) => sum + result.importedCount, 0) >= 1, 'concurrent first sync imported no Trade');
    assert(await prisma.mt5Deal.count({ where: { server: 'harness', accountLogin: 777n } }) === 2, 'concurrent first sync duplicated or lost raw MT5 deals');
    const trade = await prisma.trade.findUniqueOrThrow({
      where: { mt5Server_mt5AccountLogin_mt5PositionId: { mt5Server: 'harness', mt5AccountLogin: 777n, mt5PositionId: 99001n } },
      include: { analysis: true },
    });
    assert(Number(trade.entryPrice) === 101.2 && Number(trade.quantityLots) === 1, 'persisted MT5 multi-fill history projected incorrectly');
    assert(Number(trade.takeProfitPrice) === 110 && Number(trade.stopLossPrice) === 95, 'persisted MT5 order TP/SL projected incorrectly');
    await prisma.tradeAnalysis.update({ where: { tradeId: trade.id }, data: { baseTimeframe: 'SENTINEL' } });
    const cursorBefore = await prisma.mt5SyncStatus.findUniqueOrThrow({ where: { server_accountLogin: { server: 'harness', accountLogin: 777n } } });
    await service.syncMt5Trades();
    const after = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id }, include: { analysis: true } });
    const cursorAfter = await prisma.mt5SyncStatus.findUniqueOrThrow({ where: { server_accountLogin: { server: 'harness', accountLogin: 777n } } });
    assert(after.analysis?.baseTimeframe === 'SENTINEL', 'MT5 resync overwrote user-owned analysis');
    assert(cursorAfter.lastSyncAt !== null && cursorBefore.lastSyncAt !== null && cursorAfter.lastSyncAt >= cursorBefore.lastSyncAt, 'MT5 cursor regressed');

    const rawCount = await prisma.mt5Deal.count();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/health')) return response({ account: { login: 777, server: 'malformed' }, initial_from: '2026-01-01T00:00:00.000Z' });
      if (url.endsWith('/api/history/deals')) return response({ deals: 'not-an-array' });
      if (url.endsWith('/api/history/orders')) return response({ orders: [] });
      return new Response('', { status: 404 });
    };
    await service.syncMt5Trades().then(
      () => { throw new Error('malformed MT5 envelope unexpectedly succeeded'); },
      (error: unknown) => assert(error instanceof Error && error.message.includes('malformed history envelope'), 'malformed MT5 envelope failed for an unexpected reason'),
    );
    assert(await prisma.mt5Deal.count() === rawCount, 'malformed MT5 response wrote rows before validation');
  } finally {
    await prisma.$disconnect();
    globalThis.fetch = originalFetch;
    if (priorBaseUrl === undefined) delete process.env.MT5_BRIDGE_BASE_URL;
    else process.env.MT5_BRIDGE_BASE_URL = priorBaseUrl;
    if (priorToken === undefined) delete process.env.MT5_BRIDGE_TOKEN;
    else process.env.MT5_BRIDGE_TOKEN = priorToken;
  }
}

async function main(): Promise<void> {
  const adminUrl = process.env.TRADE_ANALYSIS_MIGRATION_TEST_ADMIN_URL;
  assert(adminUrl, 'TRADE_ANALYSIS_MIGRATION_TEST_ADMIN_URL is required');
  const database = testDatabaseName();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const url = databaseUrl(adminUrl, database);
    const pool = new Pool({ connectionString: url });
    try {
      const directories = (await readdir(migrationsDirectory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      for (const directory of directories.filter((name) => name < tradeAnalysisMigration)) await applyPoolSql(pool, join(migrationsDirectory, directory, 'migration.sql'));
      await applyPoolSql(pool, fixturePath);
      await applyPoolSql(pool, join(migrationsDirectory, tradeAnalysisMigration, 'migration.sql'));
      await pool.query('ALTER TABLE "trades" DISABLE TRIGGER "trades_initial_trade_immutable"');
      await pool.query(`
        UPDATE "trades"
        SET
          "symbol" = CASE WHEN "id" = 'legacy-blank' THEN 'EURUSD' ELSE "symbol" END,
          "side" = CASE WHEN "id" = 'legacy-blank' THEN 'long'::"TradeSide" ELSE "side" END,
          "opened_at" = CASE "id"
            WHEN 'legacy-exact' THEN '2026-01-01T00:01:00.000Z'::timestamp
            WHEN 'legacy-blank' THEN '2026-01-01T00:30:00.000Z'::timestamp
            WHEN 'legacy-mt5' THEN '2026-01-03T00:00:00.000Z'::timestamp
            ELSE "opened_at"
          END,
          "initial_trade_id" = CASE WHEN "id" = 'legacy-blank' THEN 'legacy-exact' ELSE "initial_trade_id" END
        WHERE "id" IN ('legacy-exact', 'legacy-blank', 'legacy-mt5')
      `);
      await pool.query('ALTER TABLE "trades" ENABLE TRIGGER "trades_initial_trade_immutable"');
      for (const directory of directories.filter((name) => name > tradeAnalysisMigration && name < campaignMigration)) await applyPoolSql(pool, join(migrationsDirectory, directory, 'migration.sql'));
      await applyPoolSql(pool, join(migrationsDirectory, campaignMigration, 'migration.sql'));
      await verifyMigration(pool);
      await verifyProductionPatch(pool, url);
      await verifyMt5Sync(url);
    } finally {
      await pool.end();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    if (created && process.env.KEEP_TRADE_ANALYSIS_MIGRATION_DB !== '1') await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  }
}

main().then(() => console.log('TradeAnalysis migration verification passed.')).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
