import { PrismaClient } from '@prisma/client';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const CONFIRM = '--confirm-backfill-mfe-mae';
const CONFIRM_RETRY = '--confirm-retry-blocked-mfe-mae';
const MANIFEST_VERSION = 1;
const FORMULA_VERSION = 1;
const VALUATION_VERSION = 1;
const MANIFEST_TTL_MS = 15 * 60 * 1000;
const REAUTHORIZATION_TTL_MS = 5 * 60 * 1000;

type Scope = 'TRADE' | 'CAMPAIGN';
type SelectedTarget = {
  scope: Scope;
  targetId: string;
  generation: number;
  baseInputFingerprint: string;
  tickSnapshotToMsc: string | null;
};
type ManifestFields = {
  version: number;
  batchId: string;
  accountId: string;
  formulaVersion: number;
  valuationVersion: number;
  issuedAtMsc: number;
  expiresAtMsc: number;
  databaseFingerprint: string;
  selectedBatchFingerprint: string;
  selected: SelectedTarget[];
};
type ReviewedBatchManifest = ManifestFields & {
  kind: 'M1';
};
type ReauthorizedBatchManifest = ManifestFields & {
  kind: 'R1';
  originalManifestSha256: string;
};
type ReviewPageCursor = {
  version: number;
  accountId: string;
  databaseFingerprint: string;
  afterKey: string;
  limit: number;
  issuedAtMsc: number;
  expiresAtMsc: number;
};
type Candidate = SelectedTarget & { successCurrent: boolean };

function fail(message: string, exitCode = 1): never {
  process.exitCode = exitCode;
  throw new Error(message);
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value || value.startsWith('--')) return fail(`${name} is required`);
  return value;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(lengthPrefixed(value)).digest('hex');
}

function lengthPrefixed(value: unknown): Buffer {
  const encoded = canonical(value);
  return Buffer.from(`${Buffer.byteLength(encoded, 'utf8')}:${encoded}`, 'utf8');
}

function signingKey(): string {
  const key = process.env.MFE_MAE_MANIFEST_KEY;
  if (!key) return fail('MFE_MAE_MANIFEST_KEY is required');
  return key;
}

function sign(payload: unknown): string {
  const encoded = Buffer.from(canonical(payload)).toString('base64url');
  const signature = createHmac('sha256', signingKey()).update(lengthPrefixed(payload)).digest('base64url');
  return `${encoded}.${signature}`;
}

function verify<T>(token: string): T {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) fail('invalid signed token');
  let payload: T;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T; }
  catch { return fail('invalid signed token payload'); }
  if (Buffer.from(canonical(payload)).toString('base64url') !== encoded) fail('non-canonical signed token payload');
  const expected = createHmac('sha256', signingKey()).update(lengthPrefixed(payload)).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('invalid signed token signature');
  return payload;
}

function keyOf(scope: Scope, targetId: string): string { return `${scope}:${targetId}`; }
function isExpired(expiresAtMsc: number): boolean { return !Number.isSafeInteger(expiresAtMsc) || Date.now() > expiresAtMsc; }
function compareTargets(a: Pick<SelectedTarget, 'scope' | 'targetId'>, b: Pick<SelectedTarget, 'scope' | 'targetId'>): number {
  const scopeOrder = (scope: Scope) => scope === 'TRADE' ? 0 : 1;
  return scopeOrder(a.scope) - scopeOrder(b.scope) || Buffer.compare(Buffer.from(a.targetId), Buffer.from(b.targetId));
}

async function candidates(prisma: PrismaClient, accountId: string): Promise<{ databaseFingerprint: string; candidates: Candidate[] }> {
  const account = await prisma.mt5Account.findUnique({ where: { id: accountId }, select: { id: true, updatedAt: true } });
  if (!account) fail('account does not exist');
  const [trades, campaigns, syncStatus] = await Promise.all([
    prisma.trade.findMany({
      where: { mt5AccountId: accountId, closedAt: { not: null } },
      select: { id: true, updatedAt: true, closedAt: true, openedAt: true, symbol: true, side: true, quantityLots: true, entryPrice: true, exitPrice: true, excursionResult: { select: { status: true, successCalculationVersion: true, successInputFingerprint: true } }, excursionWorkItems: { select: { generation: true, baseInputFingerprint: true } } },
    }),
    prisma.tradeCampaign.findMany({
      where: { mt5AccountId: accountId },
      select: { id: true, updatedAt: true, rootTradeId: true, version: true, excursionResult: { select: { status: true, successCalculationVersion: true, successInputFingerprint: true } }, excursionWorkItems: { select: { generation: true, baseInputFingerprint: true } } },
    }),
    prisma.mt5SyncStatus.findUnique({ where: { accountId }, select: { lastSuccessfulSnapshotMsc: true } }),
  ]);
  const tickSnapshotToMsc = syncStatus?.lastSuccessfulSnapshotMsc?.toString() ?? null;
  const source = [
    ...trades.map((trade) => {
      const { excursionResult: _result, excursionWorkItems: _work, ...input } = trade;
      return { scope: 'TRADE' as const, targetId: trade.id, source: input };
    }),
    ...campaigns.map((campaign) => {
      const { excursionResult: _result, excursionWorkItems: _work, ...input } = campaign;
      return { scope: 'CAMPAIGN' as const, targetId: campaign.id, source: input };
    }),
  ].sort(compareTargets);
  const databaseFingerprint = digest({ account: { id: account.id, updatedAt: account.updatedAt.toISOString() }, source: source.map((item) => [item.scope, item.targetId, item.source]) });
  const result: Candidate[] = source.map((item) => {
    const row = item.scope === 'TRADE' ? trades.find((trade) => trade.id === item.targetId)! : campaigns.find((campaign) => campaign.id === item.targetId)!;
    const inputFingerprint = digest({ formulaVersion: FORMULA_VERSION, valuationVersion: VALUATION_VERSION, scope: item.scope, source: item.source });
    const work = row.excursionWorkItems[0];
    const generation = !work ? 1 : work.baseInputFingerprint === inputFingerprint ? work.generation : work.generation + 1;
    const success = row.excursionResult;
    return { scope: item.scope, targetId: item.targetId, generation, baseInputFingerprint: inputFingerprint, tickSnapshotToMsc, successCurrent: success?.status === 'SUCCESS' && success.successCalculationVersion === FORMULA_VERSION && success.successInputFingerprint === inputFingerprint };
  });
  return { databaseFingerprint, candidates: result };
}

function validateManifestIdentity(manifest: ReviewedBatchManifest, accountId: string): void {
  if (manifest.kind !== 'M1' || manifest.version !== MANIFEST_VERSION || manifest.accountId !== accountId || manifest.formulaVersion !== FORMULA_VERSION || manifest.valuationVersion !== VALUATION_VERSION || !manifest.batchId || !Array.isArray(manifest.selected)) fail('manifest identity is invalid');
  if (manifest.selectedBatchFingerprint !== digest(manifest.selected)) fail('manifest selected batch fingerprint does not match');
  const ordered = [...manifest.selected].sort(compareTargets);
  if (canonical(ordered) !== canonical(manifest.selected) || new Set(manifest.selected.map((target) => keyOf(target.scope, target.targetId))).size !== manifest.selected.length) fail('manifest selected keys are not canonical and unique');
}

function validateReauthorization(manifest: ReauthorizedBatchManifest, original: ReviewedBatchManifest, accountId: string): void {
  validateManifestIdentity(original, accountId);
  if (manifest.kind !== 'R1' || !/^[a-f0-9]{64}$/.test(manifest.originalManifestSha256)) fail('reauthorization manifest is invalid or expired');
  const reauthorizedIdentity: ReviewedBatchManifest = { ...manifest, kind: 'M1' };
  validateManifestIdentity(reauthorizedIdentity, accountId);
  if (
    manifest.originalManifestSha256 !== digest(original) ||
    manifest.batchId !== original.batchId ||
    manifest.accountId !== original.accountId ||
    manifest.formulaVersion !== original.formulaVersion ||
    manifest.valuationVersion !== original.valuationVersion ||
    manifest.databaseFingerprint !== original.databaseFingerprint ||
    manifest.selectedBatchFingerprint !== original.selectedBatchFingerprint ||
    canonical(manifest.selected) !== canonical(original.selected)
  ) fail('reauthorization manifest does not exactly authorize the reviewed manifest');
  if (isExpired(manifest.expiresAtMsc)) fail('manifest is invalid or expired');
}

function matchingSelected(candidates: Candidate[], selected: SelectedTarget[]): boolean {
  const wanted = new Map(selected.map((target) => [keyOf(target.scope, target.targetId), target]));
  return candidates.length === wanted.size && candidates.every((candidate) => {
    const target = wanted.get(keyOf(candidate.scope, candidate.targetId));
    return target && target.generation === candidate.generation && target.baseInputFingerprint === candidate.baseInputFingerprint && target.tickSnapshotToMsc === candidate.tickSnapshotToMsc;
  });
}

async function dryRun(prisma: PrismaClient, accountId: string, limit: number, cursorToken?: string): Promise<void> {
  const { databaseFingerprint, candidates: universe } = await candidates(prisma, accountId);
  let afterKey: string | undefined;
  if (cursorToken) {
    const cursor = verify<ReviewPageCursor>(cursorToken);
    if (cursor.version !== MANIFEST_VERSION || cursor.accountId !== accountId || cursor.limit !== limit || cursor.databaseFingerprint !== databaseFingerprint || isExpired(cursor.expiresAtMsc)) fail('review cursor is invalid or expired');
    afterKey = cursor.afterKey;
  }
  const currentSkipped = universe.filter((candidate) => candidate.successCurrent).length;
  const cursorTarget = afterKey ? (() => {
    const separator = afterKey.indexOf(':');
    const scope = afterKey.slice(0, separator);
    return (scope === 'TRADE' || scope === 'CAMPAIGN') && separator > 0
      ? { scope: scope as Scope, targetId: afterKey.slice(separator + 1) }
      : fail('review cursor afterKey is invalid');
  })() : undefined;
  const eligible = universe.filter((candidate) => !candidate.successCurrent && (!cursorTarget || compareTargets(candidate, cursorTarget) > 0));
  const selected = eligible.slice(0, limit).map(({ successCurrent: _successCurrent, ...target }) => target);
  const now = Date.now();
  const manifest: ReviewedBatchManifest = { kind: 'M1', version: MANIFEST_VERSION, batchId: randomUUID(), accountId, formulaVersion: FORMULA_VERSION, valuationVersion: VALUATION_VERSION, issuedAtMsc: now, expiresAtMsc: now + MANIFEST_TTL_MS, databaseFingerprint, selectedBatchFingerprint: digest(selected), selected };
  const next = eligible.length > selected.length ? { version: MANIFEST_VERSION, accountId, databaseFingerprint, afterKey: keyOf(selected.at(-1)!.scope, selected.at(-1)!.targetId), limit, issuedAtMsc: now, expiresAtMsc: now + MANIFEST_TTL_MS } satisfies ReviewPageCursor : undefined;
  console.log(JSON.stringify({ mode: 'dry-run', batchId: manifest.batchId, universeCount: universe.length, currentSkipped, eligibleCount: eligible.length, selectedCount: selected.length, reviewedBatchManifest: sign(manifest), ...(next ? { nextReviewPageCursor: sign(next) } : {}), databaseFingerprint, selected }, null, 2));
}

async function reauthorize(prisma: PrismaClient, accountId: string, token: string): Promise<void> {
  const manifest = verify<ReviewedBatchManifest>(token);
  validateManifestIdentity(manifest, accountId);
  const current = await candidates(prisma, accountId);
  if (current.databaseFingerprint !== manifest.databaseFingerprint) fail('manifest database fingerprint drifted', 4);
  const selected = current.candidates.filter((candidate) => manifest.selected.some((target) => keyOf(target.scope, target.targetId) === keyOf(candidate.scope, candidate.targetId)));
  if (!matchingSelected(selected, manifest.selected)) fail('manifest target input drifted', 4);
  const now = Date.now();
  const reauthorized: ReauthorizedBatchManifest = {
    ...manifest,
    kind: 'R1',
    issuedAtMsc: now,
    expiresAtMsc: now + REAUTHORIZATION_TTL_MS,
    originalManifestSha256: digest(manifest),
  };
  console.log(JSON.stringify({ mode: 'reauthorize', accountId, selectedCount: manifest.selected.length, reauthorizedBatchManifest: sign(reauthorized), databaseFingerprint: manifest.databaseFingerprint }));
}

async function apply(prisma: PrismaClient, accountId: string, token: string, reauthorizationToken?: string): Promise<void> {
  if (process.env.MFE_MAE_BACKFILL_ENABLED !== 'true') fail('MFE_MAE_BACKFILL_ENABLED must be true for apply');
  const manifest = verify<ReviewedBatchManifest>(token);
  validateManifestIdentity(manifest, accountId);
  const reauthorization = reauthorizationToken ? verify<ReauthorizedBatchManifest>(reauthorizationToken) : undefined;
  if (reauthorization) validateReauthorization(reauthorization, manifest, accountId);
  if (isExpired((reauthorization ?? manifest).expiresAtMsc)) fail('manifest is invalid or expired');
  const retryBlocked = Boolean(reauthorization && process.argv.includes(CONFIRM_RETRY));
  const first = await candidates(prisma, accountId);
  const revalidate = (): Promise<{ databaseFingerprint: string; candidates: Candidate[] }> => candidates(prisma, accountId);
  if (first.databaseFingerprint !== manifest.databaseFingerprint) fail('manifest database fingerprint drifted', 4);
  const wanted = new Set(manifest.selected.map((target) => keyOf(target.scope, target.targetId)));
  const match = (set: Candidate[]) => matchingSelected(set, manifest.selected);
  if (!match(first.candidates.filter((candidate) => wanted.has(keyOf(candidate.scope, candidate.targetId))))) fail('manifest target input drifted', 4);
  const counts = { succeeded: 0, alreadyCurrent: 0, stale: 0, failed: 0, blocked: 0, deferred: 0 };
  for (const target of manifest.selected) {
    const latest = await revalidate();
    if (latest.databaseFingerprint !== manifest.databaseFingerprint || !match(latest.candidates.filter((candidate) => wanted.has(keyOf(candidate.scope, candidate.targetId))))) fail('manifest input drifted before claim', 4);
    const candidate = latest.candidates.find((item) => keyOf(item.scope, item.targetId) === keyOf(target.scope, target.targetId))!;
    const tickSnapshotToMsc = candidate.tickSnapshotToMsc === null ? null : BigInt(candidate.tickSnapshotToMsc);
    if (candidate.successCurrent) { counts.alreadyCurrent++; continue; }
    const existing = candidate.scope === 'TRADE'
      ? await prisma.excursionWorkItem.findUnique({ where: { scope_targetId: { scope: 'TRADE', targetId: candidate.targetId } } })
      : await prisma.excursionWorkItem.findUnique({ where: { scope_targetId: { scope: 'CAMPAIGN', targetId: candidate.targetId } } });
    if (existing?.state === 'BLOCKED') {
      if (!retryBlocked) { counts.blocked++; continue; }
      const retried = await prisma.$transaction(async (transaction) => {
        const current = await candidates(transaction as PrismaClient, accountId);
        if (
          current.databaseFingerprint !== manifest.databaseFingerprint ||
          !match(current.candidates.filter((item) => wanted.has(keyOf(item.scope, item.targetId))))
        ) fail('manifest input drifted before retry', 4);
        const reset = await transaction.excursionWorkItem.updateMany({
          where: {
            scope: candidate.scope,
            targetId: candidate.targetId,
            accountId,
            state: 'BLOCKED',
            generation: candidate.generation,
            baseInputFingerprint: candidate.baseInputFingerprint,
            tickSnapshotToMsc,
          },
          data: {
            state: 'PENDING',
            reason: 'HISTORICAL_BACKFILL',
            notBefore: null,
            claimId: null,
            claimExpiresAt: null,
            consecutiveFailures: 0,
            manualRetryEpoch: { increment: 1 },
          },
        });
        return reset.count === 1;
      }, { isolationLevel: 'Serializable' });
      if (retried) { counts.deferred++; continue; }
      counts.blocked++;
      continue;
    }
    if (existing?.state === 'CLAIMED') { counts.deferred++; continue; }
    if (tickSnapshotToMsc === null) { counts.deferred++; continue; }
    await prisma.excursionWorkItem.upsert({ where: { scope_targetId: { scope: candidate.scope, targetId: candidate.targetId } }, create: { scope: candidate.scope, targetId: candidate.targetId, tradeId: candidate.scope === 'TRADE' ? candidate.targetId : null, campaignId: candidate.scope === 'CAMPAIGN' ? candidate.targetId : null, accountId, generation: candidate.generation, baseInputFingerprint: candidate.baseInputFingerprint, tickSnapshotToMsc, reason: 'HISTORICAL_BACKFILL', state: 'PENDING' }, update: { generation: candidate.generation, baseInputFingerprint: candidate.baseInputFingerprint, tickSnapshotToMsc, reason: 'HISTORICAL_BACKFILL', state: 'PENDING', notBefore: null, claimId: null, claimExpiresAt: null } });
    counts.deferred++;
  }
  const remainingAfter = (await candidates(prisma, accountId)).candidates.filter((candidate) => !candidate.successCurrent).length;
  const batchState = counts.deferred || counts.blocked ? 'incomplete' : 'complete';
  console.log(JSON.stringify({ mode: 'apply', batchId: manifest.batchId, selectedCount: manifest.selected.length, ...counts, batchState, remainingAfter, databaseFingerprint: manifest.databaseFingerprint }));
  process.exitCode = counts.blocked ? 5 : batchState === 'incomplete' ? 3 : 0;
}

async function main(): Promise<void> {
  const applyMode = process.argv.includes('--apply');
  const reauthorizeMode = process.argv.includes('--reauthorize');
  const cursor = argument('--review-page-cursor');
  const reauthorizationManifest = argument('--reauthorization-manifest');
  const accountId = requiredArgument('--account-id');
  const rawLimit = argument('--limit') ?? '100';
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) fail('--limit must be an integer from 1 through 500');
  if (applyMode && reauthorizeMode) fail('--apply and --reauthorize cannot be combined');
  if (reauthorizeMode) {
    if (cursor || reauthorizationManifest || process.argv.includes(CONFIRM_RETRY)) fail('review page cursors and retry confirmation are apply-only');
    const prisma = new PrismaClient();
    try { await reauthorize(prisma, accountId, requiredArgument('--batch-manifest')); }
    finally { await prisma.$disconnect(); }
    return;
  }
  if (applyMode) {
    if (!process.argv.includes(CONFIRM)) fail(`Refusing apply without ${CONFIRM}`);
    if (cursor) fail('review page cursors are dry-run only');
    if (process.argv.includes(CONFIRM_RETRY) && !reauthorizationManifest) fail(`${CONFIRM_RETRY} requires --reauthorization-manifest`);
    const prisma = new PrismaClient();
    try { await apply(prisma, accountId, requiredArgument('--batch-manifest'), reauthorizationManifest); }
    finally { await prisma.$disconnect(); }
    return;
  }
  if (argument('--batch-manifest') || reauthorizationManifest || process.argv.includes(CONFIRM_RETRY)) fail('batch manifests and retry confirmation are apply- or reauthorize-only');
  const prisma = new PrismaClient();
  try { await dryRun(prisma, accountId, limit, cursor); } finally { await prisma.$disconnect(); }
}

void main().catch((error: unknown) => { console.error(error); if (!process.exitCode) process.exitCode = 1; });
