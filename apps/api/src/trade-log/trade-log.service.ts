import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  HealthResponse,
  PatchTradeAnalysisRequest,
  PatchTradeCampaignAnalysisRequest,
  PatchTradeCampaignMemoRequest,
  PatchTradeCampaignReviewRequest,
  PatchTradeStatsPreferencesRequest,
  RelinkTradeCampaignRequest,
  ResolveCampaignConflictRequest,
  SetTradeCampaignHeadRequest,
  TradeCampaign,
  CampaignHeadMutationResponse,
  TradeCampaignDateResponse,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeRecord,
  TradeStatsDimension,
  TradeStatsBucket,
  TradeStatsGranularity,
  TradeStatsPreferences,
  TradeStatsQuery,
  TradeStatsResponse,
  TradeStatsSession,
  TradeStatsExcursions,
  TradeExcursionResult,
  CampaignExcursionResult,
  ExcursionFailureReason,
  UnsetTradeCampaignHeadRequest,
} from '@trading-journal/shared';
import {
  Prisma,
  TradeAnalysisBollingerBandCount as PrismaBollingerBandCount,
  TradeAnalysisBollingerDirection as PrismaBollingerDirection,
  TradeAnalysisEconomicIndicatorImpact as PrismaIndicatorImpact,
  TradeExecutionEvaluation as PrismaExecutionEvaluation,
  TradeAnalysisPrimaryTrend as PrismaPrimaryTrend,
  TradeSide as PrismaTradeSide,
  TradeStatus as PrismaTradeStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lockOwnedMt5Account } from '../mt5-accounts/mt5-account-lock';

const EXCURSION_FAILURE_REASON_MAP: Record<string, ExcursionFailureReason> = {
  HETEROGENEOUS_CAMPAIGN_PRICE_UNAVAILABLE: 'HETEROGENEOUS_CAMPAIGN_PRICE_UNAVAILABLE',
  UNSUPPORTED_VALUATION: 'VALUATION_UNSUPPORTED',
  UNSUPPORTED_TIMELINE: 'UNSUPPORTED_DEAL_SEQUENCE',
  UNSUPPORTED_REVERSAL: 'UNSUPPORTED_DEAL_SEQUENCE',
  RISK_UNAVAILABLE: 'UNSUPPORTED_DEAL_SEQUENCE',
  INVALID_TICK_PATH: 'TICK_INVALID_PAYLOAD',
  TICK_SOURCE_LIMIT: 'TICK_SOURCE_LIMIT',
  TICK_CURSOR_EXPIRED: 'TICK_CURSOR_EXPIRED',
  TICK_CAPACITY: 'TICK_CAPACITY',
  TICK_DEADLINE: 'TICK_DEADLINE',
  WORKER_DEADLINE: 'TICK_DEADLINE',
  WORKER_SHUTDOWN: 'TICK_DEADLINE',
  TICK_UNAVAILABLE: 'TICK_UNAVAILABLE',
  TRANSIENT_BRIDGE_FAILURE: 'TICK_UNAVAILABLE',
  TICK_INVALID_PAYLOAD: 'TICK_INVALID_PAYLOAD',
  CALCULATION_FAILURE: 'TICK_INVALID_PAYLOAD',
  TICK_IDENTITY_MISMATCH: 'TICK_IDENTITY_MISMATCH',
  INPUT_CHANGED: 'INPUT_CHANGED',
  SYNC_CHANGED: 'INPUT_CHANGED',
  RECLASSIFIED: 'INPUT_CHANGED',
  INPUT_MUTATED: 'INPUT_CHANGED',
  MEMBER_INPUT_MUTATED: 'INPUT_CHANGED',
  MEMBERSHIP_MUTATED: 'INPUT_CHANGED',
  ACCOUNT_MUTATED: 'INPUT_CHANGED',
  stale: 'INPUT_CHANGED',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  NO_SYNC_SNAPSHOT: 'NO_SYNC_SNAPSHOT',
};

function publicExcursionFailureReason(reason: unknown): ExcursionFailureReason {
  if (typeof reason !== 'string' || !(reason in EXCURSION_FAILURE_REASON_MAP)) {
    throw new Error('Excursion attempt has an unsupported failure reason');
  }
  return EXCURSION_FAILURE_REASON_MAP[reason];
}
import { validateTradeAnalysisPatchRequest, validateTradeCampaignAnalysisPatchRequest, validateTradeCampaignReviewPatchRequest } from './trade-log.validation';
import { calculateExecutionBasedMetrics, calculateTradePlanMetrics } from './trade-plan-metrics';

export interface TradeScopeInput { accountId?: string; }

const tradeWithRelations = Prisma.validator<Prisma.TradeDefaultArgs>()({ include: { entry: true, exit: true, initialPlan: true, analysis: true, excursionResult: true, campaignMembership: { include: { campaign: { include: { excursionResult: true } } } } } });
type TradeWithRelations = Prisma.TradeGetPayload<typeof tradeWithRelations>;
const campaignWithRelations = Prisma.validator<Prisma.TradeCampaignDefaultArgs>()({
  include: {
    analysis: { include: { economicIndicators: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } } },
    rootTrade: { include: tradeWithRelations.include },
    memberships: { include: { trade: { include: tradeWithRelations.include } }, orderBy: { createdAt: 'asc' } },
    conflicts: { orderBy: { createdAt: 'asc' } },
    images: { where: { publishedAt: { not: null } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] },
    excursionResult: true,
  },
});
type CampaignWithRelations = Prisma.TradeCampaignGetPayload<typeof campaignWithRelations>;
type Tx = Prisma.TransactionClient;
const analysisFields = ['baseTimeframe','bollingerBandCount','bollingerDirection','executionEvaluation','unplannedAdditionalEntry','excessiveSize','stopLossViolation','earlyExit','lateExit','otherViolation'] as const;
const campaignAnalysisFields = ['primaryTrend','maTimeframes','marketZoneEnabled','marketZoneHigh','marketZoneLow','retailPositionEnabled','retailBuyAveragePrice','retailSellAveragePrice','retailBuyRatio','fibonacciEnabled','fibonacciStartPrice','fibonacciEndPrice'] as const;
type StatsSample = { id: string; type: 'campaign' | 'trade'; campaignId?: string; trades: TradeRecord[]; openedAt: string; closedAt: string; realizedPnl: number; lots: number; oneLotPnl?: number; seedBalance?: number; riskAmount?: number; riskPercent?: number; sessions: TradeStatsSession[] };

@Injectable()
export class TradeLogService {
  constructor(private readonly prisma: PrismaService) {}
  health(): HealthResponse { return { status: 'ok', service: 'sentra-trade-log', timestamp: new Date().toISOString() }; }

  async getTrade(ownerId: string, accountId: string | undefined, id: string): Promise<TradeRecord> {
    const trade = await this.findTrade(this.prisma, ownerId, accountId, id);
    return this.serialize(trade, await this.loadProvenEntryBalanceMap([trade]));
  }

  async patchTradeAnalysis(ownerId: string, accountId: string | undefined, id: string, request: PatchTradeAnalysisRequest): Promise<TradeRecord> {
    validateTradeAnalysisPatchRequest(request);
    await this.findTrade(this.prisma, ownerId, accountId, id);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; updated_at: Date }>>(Prisma.sql`SELECT id, updated_at FROM "trade_analyses" WHERE trade_id = ${id} FOR UPDATE`);
      if (!rows.length) throw new NotFoundException(`Trade ${id} not found`);
      if (rows[0].updated_at.getTime() !== new Date(request.expectedUpdatedAt).getTime()) throw new ConflictException('Trade analysis was updated by another request');
      const current = await tx.tradeAnalysis.findUniqueOrThrow({ where: { id: rows[0].id } });
      const data: Record<string, unknown> = {};
      for (const field of analysisFields) {
        if (request[field] !== undefined) data[field] = request[field];
      }
      if (request.bollingerBandCount !== undefined) data.bollingerBandCount = request.bollingerBandCount === null ? null : PrismaBollingerBandCount[request.bollingerBandCount.toUpperCase() as keyof typeof PrismaBollingerBandCount];
      if (request.bollingerDirection !== undefined) data.bollingerDirection = request.bollingerDirection === null ? null : PrismaBollingerDirection[request.bollingerDirection.toUpperCase() as keyof typeof PrismaBollingerDirection];
      if (request.executionEvaluation !== undefined) data.executionEvaluation = request.executionEvaluation === null ? null : PrismaExecutionEvaluation[request.executionEvaluation.toUpperCase() as keyof typeof PrismaExecutionEvaluation];
      if (request.executionEvaluation !== undefined && request.executionEvaluation !== 'plan_violated') {
        data.unplannedAdditionalEntry = false;
        data.excessiveSize = false;
        data.stopLossViolation = false;
        data.earlyExit = false;
        data.lateExit = false;
        data.otherViolation = null;
      }
      this.canonicalizeAndValidate({ ...current, ...data });
      await tx.tradeAnalysis.update({ where: { id: current.id }, data });
      if (request.plannedTakeProfitPrice !== undefined && request.plannedStopLossPrice !== undefined) {
        if (request.plannedTakeProfitPrice === null || request.plannedStopLossPrice === null) {
          await tx.trade.update({ where: { id }, data: {
            plannedTakeProfitPrice: null, plannedStopLossPrice: null, riskAmount: null, riskPercent: null,
            returnPercent: null, initialPlanId: null, initialPlanMetricContractVersion: null,
          } });
        } else {
          const metricTrade = await this.findTrade(tx, ownerId, accountId, id);
          const takeProfit = new Prisma.Decimal(request.plannedTakeProfitPrice);
          const stopLoss = new Prisma.Decimal(request.plannedStopLossPrice);
          const metrics = metricTrade.initialPlan
            ? calculateTradePlanMetrics(metricTrade.initialPlan, takeProfit, stopLoss)
            : calculateExecutionBasedMetrics(metricTrade, takeProfit, stopLoss);
          if (!metrics) throw new BadRequestException('TP/SL metrics require valid entry, exit, PNL, and seed data');
          await tx.trade.update({ where: { id }, data: {
            plannedTakeProfitPrice: takeProfit, plannedStopLossPrice: stopLoss,
            riskAmount: metrics.riskAmount, riskPercent: metrics.riskPercent, returnPercent: metrics.returnPercent,
            initialPlanId: metricTrade.initialPlan?.id ?? null,
            initialPlanMetricContractVersion: metricTrade.initialPlan?.metricContractVersion ?? null,
          } });
        }
      }
      const trade = await this.findTrade(tx, ownerId, accountId, id);
      return this.serialize(trade, await this.loadProvenEntryBalanceMap([trade], tx));
    });
  }

  async patchCampaignAnalysis(ownerId: string, accountId: string | undefined, id: string, request: PatchTradeCampaignAnalysisRequest): Promise<void> {
    validateTradeCampaignAnalysisPatchRequest(request);
    await this.prisma.$transaction(async (tx) => {
      if (!accountId) throw new BadRequestException('accountId is required');
      await lockOwnedMt5Account(tx, ownerId, accountId);
      const rows = await tx.$queryRaw<Array<{ id: string; updated_at: Date }>>(Prisma.sql`
        SELECT analysis.id, analysis.updated_at
        FROM "trade_campaign_analyses" analysis
        JOIN "trade_campaigns" campaign ON campaign.id = analysis.campaign_id
        WHERE campaign.id = ${id} AND campaign.owner_id = ${ownerId}
          AND (${accountId ?? null}::text IS NULL OR campaign.mt5_account_id = ${accountId ?? null})
        FOR UPDATE
      `);
      if (!rows.length) throw new NotFoundException(`Campaign ${id} not found`);
      if (rows[0].updated_at.getTime() !== new Date(request.expectedUpdatedAt).getTime()) throw new ConflictException('Campaign analysis was updated by another request');
      const current = await tx.tradeCampaignAnalysis.findUniqueOrThrow({ where: { id: rows[0].id }, include: { economicIndicators: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } } });
      const data: Record<string, unknown> = {};
      for (const field of campaignAnalysisFields) if (request[field] !== undefined) data[field] = request[field];
      if (request.primaryTrend !== undefined) data.primaryTrend = request.primaryTrend === null ? null : PrismaPrimaryTrend[request.primaryTrend.toUpperCase() as keyof typeof PrismaPrimaryTrend];
      this.canonicalizeDisabledGroups(request, data);
      this.canonicalizeAndValidate({ ...current, ...data });
      if (request.economicIndicators !== undefined) {
        const currentIds = new Set(current.economicIndicators.map((indicator) => indicator.id));
        const suppliedIds = request.economicIndicators.flatMap((indicator) => indicator.id ? [indicator.id] : []);
        if (suppliedIds.some((indicatorId) => !currentIds.has(indicatorId))) throw new BadRequestException('Economic indicator id does not belong to this campaign analysis');
        await tx.tradeCampaignAnalysisEconomicIndicator.deleteMany({ where: { campaignAnalysisId: current.id, id: { in: [...currentIds].filter((indicatorId) => !suppliedIds.includes(indicatorId)) } } });
        await tx.$executeRaw`UPDATE "trade_campaign_analysis_economic_indicators" SET "position" = -"position" - 1 WHERE "campaign_analysis_id" = ${current.id}`;
        for (const [position, indicator] of request.economicIndicators.entries()) {
          const indicatorData = { type: indicator.type.trim(), impact: indicator.impact === 'positive' ? PrismaIndicatorImpact.POSITIVE : PrismaIndicatorImpact.NEGATIVE, announcedAt: indicator.announcedAt ? new Date(indicator.announcedAt) : null, position };
          if (indicator.id) await tx.tradeCampaignAnalysisEconomicIndicator.update({ where: { id: indicator.id }, data: indicatorData });
          else await tx.tradeCampaignAnalysisEconomicIndicator.create({ data: { campaignAnalysisId: current.id, ...indicatorData } });
        }
      }
      await tx.tradeCampaignAnalysis.update({ where: { id: current.id }, data });
    });
  }
  async patchCampaignReview(ownerId: string, accountId: string | undefined, id: string, request: PatchTradeCampaignReviewRequest): Promise<void> {
    validateTradeCampaignReviewPatchRequest(request);
    await this.prisma.$transaction(async (tx) => {
      if (!accountId) throw new BadRequestException('accountId is required');
      await lockOwnedMt5Account(tx, ownerId, accountId);
      const rows = await tx.$queryRaw<Array<{
        id: string; review_updated_at: Date; entry_reason: string | null; invalidation_condition: string | null;
        take_profit_condition: string | null; additional_entry_plan: string | null; trade_score: number | null;
        strengths: string | null; weaknesses: string | null;
      }>>(Prisma.sql`
        SELECT analysis.id, analysis.review_updated_at, analysis.entry_reason, analysis.invalidation_condition,
          analysis.take_profit_condition, analysis.additional_entry_plan, analysis.trade_score, analysis.strengths, analysis.weaknesses
        FROM "trade_campaign_analyses" analysis
        JOIN "trade_campaigns" campaign ON campaign.id = analysis.campaign_id
        WHERE campaign.id = ${id} AND campaign.owner_id = ${ownerId}
          AND (${accountId ?? null}::text IS NULL OR campaign.mt5_account_id = ${accountId ?? null})
        FOR UPDATE
      `);
      if (!rows.length) throw new NotFoundException(`Campaign ${id} not found`);
      const current = rows[0];
      if (current.review_updated_at.getTime() !== new Date(request.expectedReviewUpdatedAt).getTime()) throw new ConflictException('Campaign review was updated by another request');
      await tx.$executeRaw`
        UPDATE "trade_campaign_analyses"
        SET "entry_reason" = ${request.entryReason !== undefined ? request.entryReason : current.entry_reason},
            "invalidation_condition" = ${request.invalidationCondition !== undefined ? request.invalidationCondition : current.invalidation_condition},
            "take_profit_condition" = ${request.takeProfitCondition !== undefined ? request.takeProfitCondition : current.take_profit_condition},
            "additional_entry_plan" = ${request.additionalEntryPlan !== undefined ? request.additionalEntryPlan : current.additional_entry_plan},
            "trade_score" = ${request.tradeScore !== undefined ? request.tradeScore : current.trade_score},
            "strengths" = ${request.strengths !== undefined ? request.strengths : current.strengths},
            "weaknesses" = ${request.weaknesses !== undefined ? request.weaknesses : current.weaknesses},
            "review_updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${current.id}
      `;
    });
  }
  async patchCampaignMemo(ownerId: string, accountId: string | undefined, id: string, request: PatchTradeCampaignMemoRequest): Promise<void> {
    if (!request || (request.memo !== null && typeof request.memo !== 'string')
      || typeof request.expectedUpdatedAt !== 'string' || Number.isNaN(Date.parse(request.expectedUpdatedAt))) {
      throw new BadRequestException('memo and expectedUpdatedAt are invalid');
    }
    await this.prisma.$transaction(async (tx) => {
      if (!accountId) throw new BadRequestException('accountId is required');
      await lockOwnedMt5Account(tx, ownerId, accountId);
      const rows = await tx.$queryRaw<Array<{ updated_at: Date }>>(Prisma.sql`
        SELECT updated_at FROM "trade_campaigns"
        WHERE id = ${id} AND owner_id = ${ownerId}
          AND (${accountId ?? null}::text IS NULL OR mt5_account_id = ${accountId ?? null})
        FOR UPDATE
      `);
      if (!rows.length) throw new NotFoundException(`Campaign ${id} not found`);
      if (rows[0].updated_at.getTime() !== new Date(request.expectedUpdatedAt).getTime()) {
        throw new ConflictException('Campaign memo was updated by another request');
      }
      await tx.tradeCampaign.update({
        where: { id },
        data: { memo: request.memo?.trim() || null },
      });
    });
  }

  async listCampaigns(ownerId: string, date?: string, accountId?: string): Promise<TradeCampaignDateResponse> {
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const ownerScope = await this.ownerScope(ownerId, { accountId });
    const preferences = await this.getStatsPreferences(ownerId);
    const calendarRows = await this.prisma.$queryRaw<Array<{
      tradingDate: Date;
      tradeCount: bigint;
      campaignCount: bigint;
      realizedPnl: Prisma.Decimal;
    }>>(Prisma.sql`
      WITH campaign_days AS (
        SELECT
          tc.id,
          (
            CASE
              WHEN BOOL_AND(t.closed_at IS NOT NULL) THEN MAX(t.closed_at)
              ELSE MIN(t.opened_at)
            END AT TIME ZONE 'UTC' AT TIME ZONE ${preferences.timeZone}
              - make_interval(mins => ${preferences.tradingDayStartMinutes}::int)
          )::date AS journal_date
        FROM trade_campaigns tc
        JOIN campaign_memberships cm ON cm.campaign_id = tc.id
        JOIN trades t ON t.id = cm.trade_id
        WHERE tc.owner_id = ${ownerScope.ownerId}
          AND tc.mt5_account_id = ${ownerScope.mt5AccountId}
        GROUP BY tc.id
      )
      SELECT
        cd.journal_date AS "tradingDate",
        COUNT(cm.id) AS "tradeCount",
        COUNT(DISTINCT cd.id) AS "campaignCount",
        COALESCE(SUM(t.realized_pnl), 0) AS "realizedPnl"
      FROM campaign_days cd
      JOIN campaign_memberships cm ON cm.campaign_id = cd.id
      JOIN trades t ON t.id = cm.trade_id
      GROUP BY cd.journal_date
      ORDER BY cd.journal_date ASC
    `);
    const calendarDays = calendarRows.map((row) => ({
      date: this.seoulDate(row.tradingDate),
      tradeCount: Number(row.tradeCount),
      campaignCount: Number(row.campaignCount),
      realizedPnl: Number(row.realizedPnl),
    }));
    const actualDates = calendarDays.map(({ date: tradingDate }) => tradingDate);
    const selectedDate = date ?? actualDates.at(-1);
    const index = selectedDate ? actualDates.indexOf(selectedDate) : -1;
    const selectedCampaignIds = index >= 0 ? await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT tc.id
      FROM trade_campaigns tc
      JOIN campaign_memberships cm ON cm.campaign_id = tc.id
      JOIN trades t ON t.id = cm.trade_id
      WHERE tc.owner_id = ${ownerScope.ownerId}
        AND tc.mt5_account_id = ${ownerScope.mt5AccountId}
      GROUP BY tc.id
      HAVING (
        CASE
          WHEN BOOL_AND(t.closed_at IS NOT NULL) THEN MAX(t.closed_at)
          ELSE MIN(t.opened_at)
        END AT TIME ZONE 'UTC' AT TIME ZONE ${preferences.timeZone}
          - make_interval(mins => ${preferences.tradingDayStartMinutes}::int)
      )::date = ${selectedDate}::date
    `) : [];
    const campaigns = selectedCampaignIds.length ? await this.prisma.tradeCampaign.findMany({
      where: { ...ownerScope, id: { in: selectedCampaignIds.map((campaign) => campaign.id) } },
      include: campaignWithRelations.include,
      orderBy: { rootTrade: { openedAt: 'asc' } },
    }) : [];
    const provenBalances = await this.loadProvenEntryBalanceMap(campaigns.flatMap((campaign) => [campaign.rootTrade, ...campaign.memberships.map((membership) => membership.trade)]));
    const unresolvedConflicts = campaigns.length
      ? await this.prisma.campaignConflict.findMany({ where: { status: 'UNRESOLVED', trade: ownerScope }, orderBy: { createdAt: 'asc' } })
      : [];
    const missingOpenedAtTradeIds = (await this.prisma.trade.findMany({ where: { ...ownerScope, mt5Server: { not: null }, openedAt: null }, select: { id: true } })).map((trade) => trade.id);
    return {
      date: selectedDate,
      previousDate: index > 0 ? actualDates[index - 1] : undefined,
      nextDate: index >= 0 && index < actualDates.length - 1 ? actualDates[index + 1] : undefined,
      campaigns: await Promise.all(campaigns.map(async (campaign) => this.serializeCampaign(await this.orderCampaignForSerialization(this.prisma, {
        ...campaign,
        conflicts: [
          ...campaign.conflicts,
          ...unresolvedConflicts.filter((conflict) => Array.isArray(conflict.candidateCampaignIds) && conflict.candidateCampaignIds.includes(campaign.id)),
        ],
      }), provenBalances, selectedDate))),
      calendarDays,
      diagnostics: { missingOpenedAtTradeIds },
    };
  }

  async relinkCampaign(ownerId: string, request: RelinkTradeCampaignRequest): Promise<void> {
    if (!request || typeof request.tradeId !== 'string' || !request.tradeId) throw new BadRequestException('tradeId is required');
    const initial = await this.findTrade(this.prisma, ownerId, request.accountId, request.tradeId);
    await this.prisma.$transaction(async (tx) => {
      if (!initial.mt5AccountId) throw new BadRequestException('Campaign membership requires an MT5 account');
      await lockOwnedMt5Account(tx, ownerId, initial.mt5AccountId);
      const trade = await this.findTrade(tx, ownerId, request.accountId, request.tradeId);
      if (!trade.openedAt) throw new BadRequestException('Trade without openedAt cannot be linked');
      const previous = await tx.campaignMembership.findUnique({ where: { tradeId: trade.id } });
      if (previous && previous.campaignId !== request.campaignId) await this.prepareCampaignForMemberMove(tx, previous.campaignId, trade.id);
      const campaignId = request.campaignId ?? (await tx.tradeCampaign.create({
        data: { rootTradeId: trade.id, tradingDate: this.seoulMidnight(trade.openedAt), ownerId, mt5AccountId: trade.mt5AccountId, analysis: { create: {} } },
      })).id;
      const target = await tx.tradeCampaign.findFirst({ where: { id: campaignId, ownerId } });
      if (!target || target.mt5AccountId !== trade.mt5AccountId) throw new BadRequestException('Campaign and trade account scope must match');
      await this.relinkCampaignInTransaction(tx, trade.id, campaignId, false);
      await this.normalizeCampaign(tx, campaignId);
    });
  }

  async setCampaignHead(ownerId: string, accountId: string | undefined, campaignId: string, request: SetTradeCampaignHeadRequest): Promise<CampaignHeadMutationResponse> {
    if (!request || typeof request.tradeId !== 'string' || !request.tradeId || !Number.isInteger(request.campaignVersion)) throw new BadRequestException('tradeId and campaignVersion are required');
    return this.mutateCampaignHead(ownerId, accountId, campaignId, request.campaignVersion, request.tradeId);
  }

  async unsetCampaignHead(ownerId: string, accountId: string | undefined, campaignId: string, request: UnsetTradeCampaignHeadRequest): Promise<CampaignHeadMutationResponse> {
    if (!request || !Number.isInteger(request.campaignVersion)) throw new BadRequestException('campaignVersion is required');
    const initial = await this.prisma.tradeCampaign.findFirst({ where: { id: campaignId, ownerId, ...(accountId ? { mt5AccountId: accountId } : {}) } });
    if (!initial?.mt5AccountId) throw new NotFoundException(`Campaign ${campaignId} not found`);
    const lockedAccountId = initial.mt5AccountId;
    return this.prisma.$transaction(async (tx) => {
      await lockOwnedMt5Account(tx, ownerId, lockedAccountId);
      await this.lockCampaignRows(tx, campaignId);
      const campaign = await tx.tradeCampaign.findFirst({ where: { id: campaignId, ownerId, mt5AccountId: lockedAccountId } });
      if (!campaign) throw new NotFoundException(`Campaign ${campaignId} not found`);
      if (campaign.version !== request.campaignVersion) throw new ConflictException('Campaign was updated by another request');
      const members = await this.orderedCampaignMembers(tx, campaignId, lockedAccountId);
      const head = members[0];
      if (!head || head.headSource !== 'MANUAL') throw new BadRequestException('Only MANUAL campaign heads can be unset');
      const accountMembers = await this.orderedAccountMembers(tx, ownerId, lockedAccountId);
      const index = accountMembers.findIndex((member) => member.tradeId === head.tradeId);
      if (index <= 0) throw new BadRequestException('Account-first campaign head cannot be unset');
      const predecessor = accountMembers[index - 1];
      const previousCampaignId = predecessor.campaignId;
      if (previousCampaignId === campaignId) throw new BadRequestException('Campaign head has no predecessor campaign');
      await this.lockCampaignRows(tx, previousCampaignId);
      const predecessorMembers = await this.orderedCampaignMembers(tx, previousCampaignId, lockedAccountId);
      const connected = predecessorMembers.some((member) => member.trade.closedAt === null || member.trade.closedAt >= head.trade.openedAt!);
      if (!connected) {
        await tx.campaignMembership.update({ where: { tradeId: head.tradeId }, data: { headSource: 'AUTO', source: 'AUTO' } });
        await tx.tradeCampaign.update({ where: { id: campaignId }, data: { version: { increment: 1 } } });
        return { campaign: await this.serializedCampaign(tx, campaignId) } as CampaignHeadMutationResponse;
      }
      await tx.campaignMembership.update({ where: { tradeId: head.tradeId }, data: { headSource: 'AUTO', source: 'AUTO' } });
      const recomputedMembers = accountMembers.map((member) => member.tradeId === head.tradeId
        ? { ...member, headSource: 'AUTO', source: 'AUTO' }
        : member);
      const component = this.connectedAutomaticComponent(recomputedMembers, index);
      const involvedCampaignIds = [...new Set(component.map((member) => member.campaignId))];
      for (const involvedCampaignId of involvedCampaignIds) if (involvedCampaignId !== previousCampaignId) await this.lockCampaignRows(tx, involvedCampaignId);
      for (const losingCampaignId of involvedCampaignIds) {
        if (losingCampaignId === previousCampaignId) continue;
        await this.preserveCampaignMerge(tx, previousCampaignId, losingCampaignId);
      }
      await tx.campaignMembership.updateMany({
        where: { tradeId: { in: component.map((member) => member.tradeId) } },
        data: { campaignId: previousCampaignId, headSource: 'AUTO' },
      });
      for (const member of component) {
        if (member.tradeId !== head.tradeId && member.headSource === 'MANUAL') {
          await tx.campaignMembership.update({
            where: { tradeId: member.tradeId },
            data: { source: 'MANUAL', headSource: 'MANUAL' },
          });
        }
      }
      for (const losingCampaignId of involvedCampaignIds) {
        if (losingCampaignId !== previousCampaignId) await tx.tradeCampaign.delete({ where: { id: losingCampaignId } });
      }
      await tx.tradeCampaign.update({ where: { id: previousCampaignId }, data: { version: { increment: 1 } } });
      await this.normalizeCampaign(tx, previousCampaignId);
      const affectedCampaignId = await this.recomputeCampaignGaps(tx, previousCampaignId, ownerId, lockedAccountId, head.tradeId);
      return {
        previousCampaign: undefined,
        campaign: await this.serializedCampaign(tx, affectedCampaignId),
      } as CampaignHeadMutationResponse;
    });
  }

  private async mutateCampaignHead(ownerId: string, accountId: string | undefined, campaignId: string, version: number, tradeId: string): Promise<CampaignHeadMutationResponse> {
    const initial = await this.prisma.tradeCampaign.findFirst({ where: { id: campaignId, ownerId, ...(accountId ? { mt5AccountId: accountId } : {}) } });
    if (!initial?.mt5AccountId) throw new NotFoundException(`Campaign ${campaignId} not found`);
    const lockedAccountId = initial.mt5AccountId;
    return this.prisma.$transaction(async (tx) => {
      await lockOwnedMt5Account(tx, ownerId, lockedAccountId);
      await this.lockCampaignRows(tx, campaignId);
      const campaign = await tx.tradeCampaign.findFirst({ where: { id: campaignId, ownerId, mt5AccountId: lockedAccountId } });
      if (!campaign) throw new NotFoundException(`Campaign ${campaignId} not found`);
      if (campaign.version !== version) throw new ConflictException('Campaign was updated by another request');
      const members = await this.orderedCampaignMembers(tx, campaignId, lockedAccountId);
      const start = members.findIndex((member) => member.tradeId === tradeId);
      if (start < 0) throw new BadRequestException('Trade does not belong to campaign');
      if (start === 0) throw new BadRequestException('Campaign head is already set');
      const selected = members[start];
      const suffix = members.slice(start);
      const groups = this.partitionCampaignRange(suffix);
      const created = await tx.tradeCampaign.create({
        data: { rootTradeId: selected.tradeId, tradingDate: this.seoulMidnight(selected.trade.openedAt!), ownerId, mt5AccountId: lockedAccountId, analysis: { create: {} } },
      });
      const createdGroups = [created];
      for (const group of groups.slice(1)) {
        const root = group[0];
        createdGroups.push(await tx.tradeCampaign.create({
          data: { rootTradeId: root.tradeId, tradingDate: this.seoulMidnight(root.trade.openedAt!), ownerId, mt5AccountId: lockedAccountId, analysis: { create: {} } },
        }));
      }
      for (const [index, group] of groups.entries()) {
        const target = createdGroups[index];
        await tx.campaignMembership.updateMany({
          where: { tradeId: { in: group.map((member) => member.tradeId) } },
          data: { campaignId: target.id, headSource: 'AUTO' },
        });
        const root = group[0];
        await tx.campaignMembership.update({
          where: { tradeId: root.tradeId },
          data: index === 0 || root.headSource === 'MANUAL'
            ? { headSource: 'MANUAL', source: 'MANUAL' }
            : { headSource: 'AUTO', source: 'AUTO' },
        });
      }
      await tx.tradeCampaign.update({ where: { id: campaign.id }, data: { version: { increment: 1 } } });
      await this.normalizeCampaign(tx, campaign.id);
      return {
        previousCampaign: await this.serializedCampaign(tx, campaign.id),
        campaign: await this.serializedCampaign(tx, created.id),
      } as CampaignHeadMutationResponse;
    });
  }

  async resolveCampaignConflict(ownerId: string, id: string, request: ResolveCampaignConflictRequest): Promise<void> {
    if (!request || typeof request.accountId !== 'string' || !request.accountId || typeof request.campaignId !== 'string' || !request.campaignId) throw new BadRequestException('accountId and campaignId are required');
    const initial = await this.prisma.campaignConflict.findFirst({ where: { id, trade: { ownerId, mt5AccountId: request.accountId } }, include: { trade: true } });
    if (!initial) throw new NotFoundException(`Unresolved campaign conflict ${id} not found`);
    await this.prisma.$transaction(async (tx) => {
      if (!initial.trade.mt5AccountId) throw new BadRequestException('Campaign membership requires an MT5 account');
      await lockOwnedMt5Account(tx, ownerId, initial.trade.mt5AccountId);
      const conflict = await tx.campaignConflict.findUnique({ where: { id } });
      if (!conflict || conflict.status !== 'UNRESOLVED') throw new NotFoundException(`Unresolved campaign conflict ${id} not found`);
      const candidates = conflict.candidateCampaignIds as string[];
      if (!Array.isArray(candidates) || !candidates.includes(request.campaignId)) throw new BadRequestException('Campaign is not a conflict candidate');
      const trade = await this.findTrade(tx, ownerId, request.accountId, conflict.tradeId);
      const campaign = await tx.tradeCampaign.findFirst({ where: { id: request.campaignId, ownerId } });
      if (!campaign || campaign.mt5AccountId !== trade.mt5AccountId) throw new BadRequestException('Campaign and trade account scope must match');
      await this.relinkCampaignInTransaction(tx, trade.id, request.campaignId);
      await tx.campaignConflict.update({ where: { id }, data: { status: 'RESOLVED', resolvedCampaignId: request.campaignId, resolvedAt: new Date() } });
    });
  }
  async getStats(ownerId: string, query: TradeStatsQuery): Promise<TradeStatsResponse> {
    const normalized = this.validateStatsQuery(query);
    const ownerScope = await this.ownerScope(ownerId, { accountId: normalized.accountId });
    const preferences = await this.getStatsPreferences(ownerId);
    const allTrades = await this.prisma.trade.findMany({
      where: ownerScope,
      ...tradeWithRelations,
      orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
    });
    const rawTrades = allTrades.filter((trade) => trade.status === PrismaTradeStatus.CLOSED && trade.entry && trade.exit && trade.closedAt && trade.realizedPnl !== null);
    const provenBalances = await this.loadProvenEntryBalanceMap(rawTrades);
    const records = rawTrades.map((trade) => this.serialize(trade, provenBalances));
    const samples = this.statsSamples(allTrades, records, normalized.unit ?? 'campaign', preferences);
    const filtered = samples.filter((sample) => this.matchesStatsFilters(sample, normalized, preferences));
    const priorBounds = this.priorStatsBounds(normalized);
    const prior = priorBounds ? samples.filter((sample) => this.matchesStatsFilters(sample, { ...normalized, from: priorBounds.from, to: priorBounds.to }, preferences)) : [];
    const overview = this.statsOverview(filtered, preferences.breakevenPercent);
    const crosstab = this.statsCrosstab(filtered, preferences.breakevenPercent, normalized.rowDimension ?? 'symbol', normalized.columnDimension ?? 'session', preferences.timeZone);
    const dimensions: TradeStatsDimension[] = ['symbol', 'side', 'exitReason', 'entryWeekday', 'session', 'baseTimeframe', 'bollingerSetup', 'executionEvaluation', 'violationFlags', 'holdDuration', 'analysisCompleteness'];
    const breakdowns = Object.fromEntries(dimensions.map((dimension) => [dimension, this.statsBreakdown(filtered, dimension, preferences.breakevenPercent, preferences.timeZone)]));
    const filterOptions = this.statsFilterOptions(samples, dimensions, preferences.breakevenPercent, preferences.timeZone);
    const performanceGroups = this.statsPerformanceGroups(filtered, normalized.groupDimensions ?? [], preferences.breakevenPercent, preferences.timeZone, normalized);
    const timeSeries = this.statsSeriesByGranularity(filtered, preferences, normalized);
    const riskR = filtered.filter((sample) => sample.riskAmount && sample.riskAmount > 0).map((sample) => sample.realizedPnl / sample.riskAmount!);
    const drawdown = this.statsDrawdown(filtered, riskR);
    const incompleteCampaignIds = [...new Set(allTrades.filter((trade) => trade.campaignMembership?.campaignId && (trade.status !== PrismaTradeStatus.CLOSED || !trade.entry || !trade.exit || !trade.closedAt || trade.realizedPnl === null)).map((trade) => trade.campaignMembership!.campaignId))];
    const diagnostics = {
      missingSeedCount: filtered.filter((sample) => !sample.seedBalance || sample.seedBalance <= 0).length,
      missingSeedIds: filtered.filter((sample) => !sample.seedBalance || sample.seedBalance <= 0).map((sample) => sample.id),
      unclassifiedCount: filtered.filter((sample) => this.statsOutcome(sample, preferences.breakevenPercent) === 'unclassified').length,
      missingLotsCount: filtered.filter((sample) => !sample.lots || sample.lots <= 0).length,
      missingLotsIds: filtered.filter((sample) => !sample.lots || sample.lots <= 0).map((sample) => sample.id),
      missingRiskCount: filtered.filter((sample) => !sample.riskAmount || sample.riskAmount <= 0).length,
      missingRiskIds: filtered.filter((sample) => !sample.riskAmount || sample.riskAmount <= 0).map((sample) => sample.id),
      incompleteCampaignCount: incompleteCampaignIds.length,
      incompleteCampaignIds,
    };
    return {
      preferences,
      query: normalized,
      overview,
      comparison: { from: normalized.from, to: normalized.to, ...(priorBounds ? { priorFrom: priorBounds.from, priorTo: priorBounds.to } : {}), current: overview, prior: this.statsOverview(prior, preferences.breakevenPercent) },
      timeSeries,
      breakdowns,
      filterOptions,
      performanceGroups,
      crosstab: { rowDimension: normalized.rowDimension ?? 'symbol', columnDimension: normalized.columnDimension ?? 'session', ...crosstab },
      drawdown,
      diagnostics,
      excursions: this.statsExcursions(filtered, new Map(allTrades.map((trade) => [trade.id, trade])), normalized.unit ?? 'campaign'),
      drilldown: filtered.map((sample) => ({ id: sample.id, targetId: sample.campaignId ?? sample.id, type: sample.type, tradeIds: sample.trades.map((trade) => trade.id), campaignId: sample.campaignId, journalDate: this.seoulDate(new Date(sample.openedAt)), accountId: sample.trades[0].accountId, symbol: sample.trades[0].symbol, side: sample.trades[0].side, openedAt: sample.openedAt, closedAt: sample.closedAt, realizedPnl: sample.realizedPnl, lots: sample.lots, outcome: this.statsOutcome(sample, preferences.breakevenPercent) })),
    };
  }
  private statsExcursions(samples: StatsSample[], raw: Map<string, TradeWithRelations>, unit: 'campaign' | 'trade'): TradeStatsExcursions {
    const distribution = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const round = (value: number) => new Prisma.Decimal(value).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP).toNumber();
      const percentile = (p: number) => {
        if (!sorted.length) return undefined;
        const position = (sorted.length - 1) * p;
        const lower = Math.floor(position), upper = Math.ceil(position);
        return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
      };
      if (!sorted.length) return { sampleCount: 0, bins: [] };
      const min = sorted[0], max = sorted[sorted.length - 1];
      if (min === max) return { sampleCount: sorted.length, mean: round(min), median: round(min), q1: round(min), q3: round(min), bins: [{ min: round(min), max: round(max), includeMax: true, count: sorted.length }] };
      const width = (max - min) / 10;
      const bins = Array.from({ length: 10 }, (_, index) => ({ min: round(min + width * index), max: round(index === 9 ? max : min + width * (index + 1)), includeMax: index === 9, count: 0 }));
      for (const value of sorted) bins[Math.min(9, Math.floor((value - min) / width))].count++;
      return { sampleCount: sorted.length, mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length), median: percentile(.5), q1: percentile(.25), q3: percentile(.75), bins };
    };
    const pair = (items: Array<{ mfe: number; mae: number }>) => ({ mfe: distribution(items.map((item) => item.mfe)), mae: distribution(items.map((item) => item.mae)) });
    const status = (items: Array<any>) => ({ success: items.filter((item) => item?.status === 'success').length, stale: items.filter((item) => item?.status === 'stale').length, failed: items.filter((item) => item?.status === 'failed').length, unsupported: items.filter((item) => item?.status === 'unsupported').length, missing: items.filter((item) => !item).length });
    const metricPair = (items: any[], family: string) => pair(items.filter((item) => item?.metrics?.[family]).map((item) => ({ mfe: item.metrics[family].mfe.value, mae: item.metrics[family].mae.value })));
    const selected = unit === 'trade'
      ? samples.flatMap((sample) => sample.trades.map((trade) => trade.excursion))
      : samples.map((sample) => raw.get(sample.trades[0].id)?.campaignMembership?.campaign.excursionResult ? this.serializeCampaignExcursion(raw.get(sample.trades[0].id)!.campaignMembership!.campaign.excursionResult) : undefined);
    if (unit === 'trade') {
      const values = selected as Array<TradeExcursionResult | undefined>;
      const current = values.filter((value): value is Extract<TradeExcursionResult, { status: 'success' }> => value?.status === 'success');
      return { unit: 'trade', families: [{ family: 'trade', status: status(values), price: metricPair(current, 'price'), percent: metricPair(current, 'percent'), unrealizedPnl: metricPair(current, 'unrealizedPnl'), r: metricPair(current.filter((value) => value.metrics.rAvailability === 'available'), 'r'), captureRate: distribution(current.flatMap((value) => value.metrics.captureRate === undefined ? [] : [value.metrics.captureRate])), counts: { eligibleSuccessCount: current.length, riskUnavailableCount: current.filter((value) => value.metrics.rAvailability === 'risk_unavailable').length, captureEligibleCount: current.filter((value) => value.metrics.captureRate !== undefined).length } }] };
    }
    const values = selected as Array<CampaignExcursionResult | undefined>;
    const price = values.map((value) => value?.price), pnl = values.map((value) => value?.unrealizedPnl);
    const priceCurrent: any[] = price.filter((value) => value?.status === 'success');
    const pnlCurrent: any[] = pnl.filter((value) => value?.status === 'success');
    return { unit: 'campaign', families: [
      { family: 'campaign_price', status: status(price), price: metricPair(priceCurrent, 'price'), percent: metricPair(priceCurrent, 'percent'), counts: { eligibleSuccessCount: priceCurrent.length, heterogeneousUnavailableCount: price.filter((value) => value?.attempt.failureReason === 'HETEROGENEOUS_CAMPAIGN_PRICE_UNAVAILABLE').length } },
      { family: 'campaign_unrealized_pnl', status: status(pnl), unrealizedPnl: metricPair(pnlCurrent, 'unrealizedPnl'), r: metricPair(pnlCurrent.filter((value) => value.metrics.rAvailability === 'available'), 'r'), captureRate: distribution(pnlCurrent.flatMap((value) => value.metrics.captureRate === undefined ? [] : [value.metrics.captureRate])), counts: { eligibleSuccessCount: pnlCurrent.length, riskUnavailableCount: pnlCurrent.filter((value) => value.metrics.rAvailability === 'risk_unavailable').length, captureEligibleCount: pnlCurrent.filter((value) => value.metrics.captureRate !== undefined).length, valuationUnavailableCount: pnl.filter((value) => value?.attempt.failureReason === 'VALUATION_UNSUPPORTED').length } },
    ] };
  }
  async getStatsPreferences(ownerId: string): Promise<TradeStatsPreferences> {
    const preference = await this.prisma.statisticsPreference.upsert({ where: { userId: ownerId }, create: { userId: ownerId }, update: {} });
    return this.serializeStatsPreferences(preference);
  }
  async patchStatsPreferences(ownerId: string, request: PatchTradeStatsPreferencesRequest): Promise<TradeStatsPreferences> {
    const data = this.validateStatsPreferences(request);
    const preference = await this.prisma.statisticsPreference.upsert({ where: { userId: ownerId }, create: { userId: ownerId, ...data }, update: data });
    return this.serializeStatsPreferences(preference);
  }
  async applyAssistantActions(ownerId: string, request: TradeLogAssistantActionsRequest): Promise<TradeLogAssistantActionsResponse> {
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.accountId !== 'string' || !request.accountId || typeof request.rawText !== 'string' || !['telegram', 'manual', 'api'].includes(request.source) || !Array.isArray(request.actions)) {
      throw new BadRequestException('Assistant request is invalid');
    }
    const trades: TradeRecord[] = [];
    for (const action of request.actions) {
      if (!action || action.type !== 'patch_trade_analysis' || !action.tradeId) throw new BadRequestException('Unsupported assistant action type');
      trades.push(await this.patchTradeAnalysis(ownerId, request.accountId, action.tradeId, action.payload));
    }
    return { rawText: request.rawText, source: request.source, trades };
  }
  private sessionMembership(occurredAt: Date, preferences: TradeStatsPreferences): TradeStatsSession[] {
    const minuteAt = (timeZone: string) => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(occurredAt);
      return Number(parts.find((part) => part.type === 'hour')!.value) * 60 + Number(parts.find((part) => part.type === 'minute')!.value);
    };
    const inRange = (minute: number, start: number, end: number) => start <= end ? minute >= start && minute < end : minute >= start || minute < end;
    const sessions = (['asia', 'london', 'new-york'] as const).filter((session) => inRange(minuteAt(session === 'asia' ? 'Asia/Tokyo' : session === 'london' ? 'Europe/London' : 'America/New_York'), preferences.sessions[session].startMinutes, preferences.sessions[session].endMinutes));
    return sessions.length ? sessions : ['off-session'];
  }
  private validateStatsQuery(query: TradeStatsQuery): TradeStatsQuery {
    if (!query || typeof query.accountId !== 'string' || !query.accountId) throw new BadRequestException('accountId is required');
    const normalized = { ...query } as TradeStatsQuery;
    for (const key of ['symbols', 'sides', 'sessions', 'baseTimeframes', 'outcomes', 'evaluations', 'violations', 'exitReasons', 'entryWeekdays', 'bollingerSetups', 'analysisCompleteness', 'holdDurationBands', 'groupDimensions'] as const) {
      const value = normalized[key];
      if (typeof value === 'string') (normalized as unknown as Record<string, unknown>)[key] = [value];
      else if (value !== undefined && (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))) throw new BadRequestException('Stats query is invalid');
    }
    const valid = <T extends string>(value: string[] | undefined, values: readonly T[]) => !value || value.every((item) => values.includes(item as T));
    if (normalized.unit !== undefined && !['campaign', 'trade'].includes(normalized.unit) || !valid(normalized.sides, ['long', 'short']) || !valid(normalized.sessions, ['asia', 'london', 'new-york', 'off-session']) || !valid(normalized.outcomes, ['win', 'loss', 'breakeven', 'unclassified']) || !valid(normalized.evaluations, ['as_planned', 'plan_violated']) || !valid(normalized.bollingerSetups, ['no_touch', 'one_band:normal', 'one_band:reverse', 'one_band:chase', 'two_band:normal', 'two_band:reverse', 'two_band:chase']) || !valid(normalized.analysisCompleteness, ['complete', 'incomplete']) || (normalized.rowDimension !== undefined && !['symbol', 'side', 'exitReason', 'entryWeekday', 'session', 'baseTimeframe', 'bollingerSetup', 'executionEvaluation', 'violationFlags', 'holdDuration', 'analysisCompleteness'].includes(normalized.rowDimension)) || (normalized.columnDimension !== undefined && !['symbol', 'side', 'exitReason', 'entryWeekday', 'session', 'baseTimeframe', 'bollingerSetup', 'executionEvaluation', 'violationFlags', 'holdDuration', 'analysisCompleteness'].includes(normalized.columnDimension))) throw new BadRequestException('Stats query is invalid');
    for (const value of [normalized.from, normalized.to]) if (value !== undefined && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) throw new BadRequestException('Stats date is invalid');
    if (normalized.from && normalized.to && new Date(normalized.from) > new Date(normalized.to)) throw new BadRequestException('Stats from must not exceed to');
    const dimensions = ['symbol', 'side', 'exitReason', 'entryWeekday', 'session', 'baseTimeframe', 'bollingerSetup', 'executionEvaluation', 'violationFlags', 'holdDuration', 'analysisCompleteness'];
    if (normalized.groupDimensions && (new Set(normalized.groupDimensions).size !== normalized.groupDimensions.length || normalized.groupDimensions.some((dimension) => !dimensions.includes(dimension)))) throw new BadRequestException('Stats grouping dimensions are invalid');
    return normalized;
  }
  private validateStatsPreferences(request: PatchTradeStatsPreferencesRequest): Record<string, unknown> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new BadRequestException('Statistics preferences are invalid');
    const allowed = new Set(['breakevenPercent', 'timeZone', 'tradingDayStartMinutes', 'sessions']);
    if (Object.keys(request).some((key) => !allowed.has(key))) throw new BadRequestException('Unknown statistics preference');
    const data: Record<string, unknown> = {};
    if (request.breakevenPercent !== undefined) { if (!Number.isFinite(request.breakevenPercent) || request.breakevenPercent < 0 || request.breakevenPercent > 100) throw new BadRequestException('breakevenPercent is invalid'); data.breakevenPercent = request.breakevenPercent; }
    if (request.timeZone !== undefined) { try { Intl.DateTimeFormat(undefined, { timeZone: request.timeZone }); } catch { throw new BadRequestException('timeZone is invalid'); } data.timeZone = request.timeZone; }
    if (request.tradingDayStartMinutes !== undefined) data.tradingDayStartMinutes = this.statsMinute(request.tradingDayStartMinutes, 'tradingDayStartMinutes');
    if (request.sessions !== undefined) for (const key of Object.keys(request.sessions)) {
      if (!['asia', 'london', 'new-york'].includes(key)) throw new BadRequestException('Unknown trading session');
      const session = request.sessions[key as 'asia' | 'london' | 'new-york']!;
      if (!session || typeof session !== 'object' || Object.keys(session).some((field) => field !== 'startMinutes' && field !== 'endMinutes')) throw new BadRequestException('Session is invalid');
      if (session.startMinutes !== undefined) data[`${key === 'new-york' ? 'newYork' : key}StartMinutes`] = this.statsMinute(session.startMinutes, `${key} startMinutes`);
      if (session.endMinutes !== undefined) data[`${key === 'new-york' ? 'newYork' : key}EndMinutes`] = this.statsMinute(session.endMinutes, `${key} endMinutes`);
    }
    return data;
  }
  private statsMinute(value: number, name: string): number { if (!Number.isInteger(value) || value < 0 || value > 1439) throw new BadRequestException(`${name} is invalid`); return value; }
  private serializeStatsPreferences(value: { breakevenPercent: Prisma.Decimal; timeZone: string; tradingDayStartMinutes: number; asiaStartMinutes: number; asiaEndMinutes: number; londonStartMinutes: number; londonEndMinutes: number; newYorkStartMinutes: number; newYorkEndMinutes: number }, reference = new Date()): TradeStatsPreferences {
    const label = (minute: number, zone: string) => this.seoulLabelForMarketMinute(minute, zone, reference);
    return { breakevenPercent: Number(value.breakevenPercent), timeZone: value.timeZone, tradingDayStartMinutes: value.tradingDayStartMinutes, sessions: { asia: { startMinutes: value.asiaStartMinutes, endMinutes: value.asiaEndMinutes }, london: { startMinutes: value.londonStartMinutes, endMinutes: value.londonEndMinutes }, 'new-york': { startMinutes: value.newYorkStartMinutes, endMinutes: value.newYorkEndMinutes } }, display: { timeZone: 'Asia/Seoul', utcOffsetMinutes: 540, tradingDayStartLabel: label(value.tradingDayStartMinutes, value.timeZone), sessions: { asia: { startLabel: label(value.asiaStartMinutes, 'Asia/Tokyo'), endLabel: label(value.asiaEndMinutes, 'Asia/Tokyo') }, london: { startLabel: label(value.londonStartMinutes, 'Europe/London'), endLabel: label(value.londonEndMinutes, 'Europe/London') }, 'new-york': { startLabel: label(value.newYorkStartMinutes, 'America/New_York'), endLabel: label(value.newYorkEndMinutes, 'America/New_York') } } } };
  }
  private seoulLabelForMarketMinute(minutes: number, marketZone: string, reference: Date): string {
    const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(reference).map((part) => [part.type, part.value]));
    let instant = new Date(Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day), Math.floor(minutes / 60), minutes % 60));
    for (let index = 0; index < 2; index++) {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: marketZone, timeZoneName: 'longOffset' }).formatToParts(instant);
      const offset = parts.find((part) => part.type === 'timeZoneName')!.value.match(/GMT([+-])(\d{2}):(\d{2})/);
      const offsetMinutes = offset ? (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
      instant = new Date(Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day), Math.floor(minutes / 60), minutes % 60) - offsetMinutes * 60000);
    }
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
  }
  private statsSamples(allTrades: TradeWithRelations[], records: TradeRecord[], unit: 'campaign' | 'trade', preferences: TradeStatsPreferences): StatsSample[] {
    const byRawId = new Map(allTrades.map((trade) => [trade.id, trade]));
    const completeCampaignIds = new Set<string>();
    const campaignMembers = new Map<string, TradeWithRelations[]>();
    for (const trade of allTrades) {
      const campaignId = trade.campaignMembership?.campaignId;
      if (campaignId) campaignMembers.set(campaignId, [...(campaignMembers.get(campaignId) ?? []), trade]);
    }
    for (const [campaignId, members] of campaignMembers) if (members.every((trade) => trade.status === PrismaTradeStatus.CLOSED && trade.entry && trade.exit && trade.closedAt && trade.realizedPnl !== null)) completeCampaignIds.add(campaignId);
    const groups = new Map<string, TradeRecord[]>();
    for (const record of records) {
      const campaignId = byRawId.get(record.id)!.campaignMembership?.campaignId;
      if (unit === 'campaign' && campaignId && !completeCampaignIds.has(campaignId)) continue;
      const key = unit === 'campaign' && campaignId ? campaignId : record.id;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, trades]) => {
      const ordered = [...trades].sort((a, b) => new Date(a.openedAt!).getTime() - new Date(b.openedAt!).getTime() || a.id.localeCompare(b.id));
      const first = ordered[0], last = [...trades].sort((a, b) => new Date(b.closedAt!).getTime() - new Date(a.closedAt!).getTime() || a.id.localeCompare(b.id))[0];
      const campaignId = byRawId.get(first.id)!.campaignMembership?.campaignId;
      const risks = trades.filter((trade) => trade.riskAmount !== undefined && trade.riskAmount > 0);
      const riskPercent = risks.length === trades.length && first.seedBalance && first.seedBalance > 0 ? risks.reduce((sum, trade) => sum + trade.riskAmount!, 0) / first.seedBalance * 100 : undefined;
      const oneLotPnls = trades.flatMap((trade) => trade.quantityLots !== undefined && trade.quantityLots > 0 && trade.realizedPnl !== undefined ? [trade.realizedPnl / trade.quantityLots] : []);
      return { id, type: unit === 'campaign' && campaignId ? 'campaign' : 'trade', campaignId: unit === 'campaign' ? campaignId : undefined, trades, openedAt: first.openedAt!, closedAt: last.closedAt!, realizedPnl: trades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0), lots: trades.reduce((sum, trade) => sum + (trade.quantityLots ?? 0), 0), ...(oneLotPnls.length ? { oneLotPnl: oneLotPnls.reduce((sum, value) => sum + value, 0) } : {}), seedBalance: first.seedBalance, riskAmount: risks.length === trades.length ? risks.reduce((sum, trade) => sum + trade.riskAmount!, 0) : undefined, riskPercent, sessions: this.sessionMembership(new Date(first.openedAt!), preferences) };
    });
  }
  private statsOneLotPnl(sample: StatsSample): number | undefined { return sample.oneLotPnl ?? (sample.lots > 0 ? sample.realizedPnl / sample.lots : undefined); }
  private statsOutcome(sample: StatsSample, threshold: number): 'win' | 'loss' | 'breakeven' | 'unclassified' { if (!sample.seedBalance || sample.seedBalance <= 0) return 'unclassified'; const percent = Math.abs(sample.realizedPnl / sample.seedBalance * 100); return percent <= threshold ? 'breakeven' : sample.realizedPnl > 0 ? 'win' : 'loss'; }
  private matchesStatsFilters(sample: StatsSample, query: TradeStatsQuery, preferences: TradeStatsPreferences): boolean {
    const outcome = this.statsOutcome(sample, preferences.breakevenPercent);
    const matchesDimension = <T extends string>(dimension: TradeStatsDimension, selected: T[] | undefined) =>
      !selected?.length || this.statsDimension(sample, dimension, preferences.timeZone).some((item) => selected.includes(item as T));
    const dateOnly = (value?: string) => value?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
    const localDay = this.statsPeriodKey(sample.closedAt, preferences, 'day');
    const fromDay = dateOnly(query.from);
    const toDay = dateOnly(query.to);
    const afterFrom = !query.from || (fromDay ? localDay >= fromDay : new Date(sample.closedAt) >= new Date(query.from));
    const beforeTo = !query.to || (toDay ? localDay <= toDay : new Date(sample.closedAt) <= new Date(query.to));
    return afterFrom
      && beforeTo
      && matchesDimension('symbol', query.symbols)
      && matchesDimension('side', query.sides)
      && matchesDimension('session', query.sessions)
      && matchesDimension('baseTimeframe', query.baseTimeframes)
      && matchesDimension('exitReason', query.exitReasons)
      && matchesDimension('entryWeekday', query.entryWeekdays)
      && matchesDimension('bollingerSetup', query.bollingerSetups)
      && matchesDimension('analysisCompleteness', query.analysisCompleteness)
      && matchesDimension('holdDuration', query.holdDurationBands)
      && (!query.outcomes?.length || query.outcomes.includes(outcome))
      && matchesDimension('executionEvaluation', query.evaluations)
      && (!query.violations?.length || query.violations.some((key) => this.statsDimension(sample, 'violationFlags', preferences.timeZone).includes(key)));
  }
  private priorStatsBounds(query: TradeStatsQuery): { from: string; to: string } | undefined {
    if (!query.from || !query.to) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.from) && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
      const first = new Date(`${query.from}T00:00:00.000Z`);
      const last = new Date(`${query.to}T00:00:00.000Z`);
      const days = Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
      const priorTo = new Date(first);
      priorTo.setUTCDate(priorTo.getUTCDate() - 1);
      const priorFrom = new Date(priorTo);
      priorFrom.setUTCDate(priorFrom.getUTCDate() - days + 1);
      return { from: priorFrom.toISOString().slice(0, 10), to: priorTo.toISOString().slice(0, 10) };
    }
    const from = new Date(query.from);
    const to = new Date(query.to);
    const priorTo = new Date(from.getTime() - 1);
    return { from: new Date(priorTo.getTime() - (to.getTime() - from.getTime())).toISOString(), to: priorTo.toISOString() };
  }
  private statsOverview(samples: StatsSample[], threshold: number): TradeStatsResponse['overview'] {
    const pnl = samples.reduce((sum, sample) => sum + sample.realizedPnl, 0), classified = samples.filter((sample) => this.statsOutcome(sample, threshold) !== 'unclassified'), wins = classified.filter((sample) => this.statsOutcome(sample, threshold) === 'win'), losses = classified.filter((sample) => this.statsOutcome(sample, threshold) === 'loss'), breakevens = classified.filter((sample) => this.statsOutcome(sample, threshold) === 'breakeven'), risks = samples.filter((sample) => sample.riskAmount && sample.riskAmount > 0), rs = risks.map((sample) => sample.realizedPnl / sample.riskAmount!);
    const grossProfit = wins.reduce((sum, sample) => sum + sample.realizedPnl, 0), grossLoss = -losses.reduce((sum, sample) => sum + sample.realizedPnl, 0), totalProfitPnl = samples.reduce((sum, sample) => sum + Math.max(0, sample.realizedPnl), 0), totalLossPnl = samples.reduce((sum, sample) => sum + Math.min(0, sample.realizedPnl), 0), oneLotPnls = samples.map((sample) => this.statsOneLotPnl(sample)).filter((value): value is number => value !== undefined);
    const ordered = [...samples].sort((left, right) => left.closedAt.localeCompare(right.closedAt) || left.id.localeCompare(right.id));
    const streak = (outcome: 'win' | 'loss') => { let current = 0, max = 0; for (const sample of ordered) { if (this.statsOutcome(sample, threshold) === outcome) { current++; max = Math.max(max, current); } else current = 0; } return { current, max }; }; const winStreak = streak('win'), lossStreak = streak('loss'), totalR = rs.reduce((sum, value) => sum + value, 0), riskPercents = samples.filter((sample) => sample.riskPercent !== undefined).map((sample) => sample.riskPercent!), classifiedPnl = classified.reduce((sum, sample) => sum + sample.realizedPnl, 0), classifiedRs = classified.filter((sample) => sample.riskAmount && sample.riskAmount > 0).map((sample) => sample.realizedPnl / sample.riskAmount!); return { totalTrades: samples.length, totalRealizedPnl: pnl, totalProfitPnl, totalLossPnl, averageRealizedPnl: samples.length ? pnl / samples.length : 0, ...(oneLotPnls.length ? { oneLotPnl: oneLotPnls.reduce((sum, value) => sum + value, 0) / oneLotPnls.length } : {}), ...(wins.length + losses.length ? { winRate: wins.length / (wins.length + losses.length) * 100 } : {}), ...(classified.length ? { breakevenRate: breakevens.length / classified.length * 100 } : {}), ...(grossLoss ? { profitFactor: grossProfit / grossLoss } : {}), ...(wins.length && losses.length ? { payoff: (grossProfit / wins.length) / (grossLoss / losses.length) } : {}), ...(classified.length ? { expectancy: classifiedPnl / classified.length } : {}), wins: wins.length, losses: losses.length, breakevens: breakevens.length, classifiedCount: classified.length, ...(wins.length ? { averageWin: grossProfit / wins.length } : {}), ...(losses.length ? { averageLoss: -grossLoss / losses.length } : {}), maxWinStreak: winStreak.max, currentWinStreak: winStreak.current, maxLossStreak: lossStreak.max, currentLossStreak: lossStreak.current, totalRiskAmount: risks.reduce((sum, sample) => sum + sample.riskAmount!, 0), riskAmountCount: risks.length, ...(riskPercents.length ? { averageRiskPercent: riskPercents.reduce((sum, value) => sum + value, 0) / riskPercents.length } : {}), riskPercentCount: riskPercents.length, r: { ...(rs.length ? { value: totalR / rs.length, total: totalR, ...(classifiedRs.length ? { expectancy: classifiedRs.reduce((sum, value) => sum + value, 0) / classifiedRs.length } : {}) } : {}), count: rs.length, missingCount: samples.length - rs.length } };
  }
  private statsDimension(sample: StatsSample, dimension: TradeStatsDimension, timeZone = 'Asia/Seoul'): string[] { const trades = sample.trades, trade = trades[0]; if (dimension === 'session') return sample.sessions; if (dimension === 'symbol') return [...new Set(trades.map((item) => item.symbol))]; if (dimension === 'side') return [...new Set(trades.map((item) => item.side))]; if (dimension === 'exitReason') return [...new Set(trades.map((item) => item.exitReason ?? 'unspecified'))]; if (dimension === 'baseTimeframe') return [...new Set(trades.map((item) => item.analysis.baseTimeframe ?? 'unspecified'))]; if (dimension === 'bollingerSetup') return [...new Set(trades.map((item) => item.analysis.bollingerBandCount === 'no_touch' ? 'no_touch' : item.analysis.bollingerBandCount && item.analysis.bollingerDirection ? `${item.analysis.bollingerBandCount}:${item.analysis.bollingerDirection}` : 'unevaluated'))]; if (dimension === 'executionEvaluation') return [...new Set(trades.map((item) => item.analysis.executionEvaluation ?? 'unspecified'))]; if (dimension === 'analysisCompleteness') return [trades.every((item) => item.analysisComplete) ? 'complete' : 'incomplete']; if (dimension === 'entryWeekday') return [new Intl.DateTimeFormat('ko-KR', { weekday: 'long', timeZone }).format(new Date(sample.openedAt))]; if (dimension === 'violationFlags') { const flags = trades.flatMap((item) => ['unplannedAdditionalEntry', 'excessiveSize', 'stopLossViolation', 'earlyExit', 'lateExit'].filter((key) => item.analysis[key as keyof TradeRecord['analysis']] === true).concat(item.analysis.otherViolation ? ['other'] : [])); return flags.length ? [...new Set(flags)] : ['none']; } const hours = (new Date(sample.closedAt).getTime() - new Date(sample.openedAt).getTime()) / 3600000; return [hours < 1 ? '<1h' : hours < 4 ? '1-4h' : hours < 24 ? '4-24h' : hours < 48 ? '24-48h' : hours < 72 ? '48-72h' : '72h+']; }
  private statsDimensionLabel(dimension: TradeStatsDimension, key: string): string {
    const labelsByDimension: Partial<Record<TradeStatsDimension, Record<string, string>>> = {
      side: { long: 'Long', short: 'Short' },
      session: { asia: '아시아장', london: '유로장', 'new-york': '미장', 'off-session': '장외' },
      bollingerSetup: {
        unevaluated: '미평가',
        no_touch: '터치 안함',
        'one_band:normal': '원볼 정볼',
        'one_band:reverse': '원볼 역볼',
        'one_band:chase': '원볼 추볼',
        'two_band:normal': '투볼 정볼',
        'two_band:reverse': '투볼 역볼',
        'two_band:chase': '투볼 추볼',
      },
    };
    return labelsByDimension[dimension]?.[key] ?? key;
  }
  private statsDimensionCompare(dimension: TradeStatsDimension, left: string, right: string): number {
    const ordered: Partial<Record<TradeStatsDimension, string[]>> = {
      side: ['long', 'short'],
      entryWeekday: ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'],
      session: ['asia', 'london', 'new-york', 'off-session'],
      holdDuration: ['<1h', '1-4h', '4-24h', '24-48h', '48-72h', '72h+'],
      bollingerSetup: ['unevaluated', 'no_touch', 'one_band:normal', 'one_band:reverse', 'one_band:chase', 'two_band:normal', 'two_band:reverse', 'two_band:chase'],
    };
    const order = ordered[dimension];
    if (!order) return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
    const leftIndex = order.indexOf(left), rightIndex = order.indexOf(right);
    if (leftIndex === -1 || rightIndex === -1) return leftIndex === rightIndex ? left.localeCompare(right, 'en', { numeric: true }) : leftIndex === -1 ? 1 : -1;
    return leftIndex - rightIndex;
  }
  private statsBreakdown(samples: StatsSample[], dimension: TradeStatsDimension, threshold: number, timeZone = 'Asia/Seoul'): TradeStatsBucket[] {
    const groups = new Map<string, StatsSample[]>(); for (const sample of samples) for (const key of this.statsDimension(sample, dimension, timeZone)) groups.set(key, [...(groups.get(key) ?? []), sample]);
    return [...groups.entries()].sort(([left], [right]) => this.statsDimensionCompare(dimension, left, right)).map(([key, items]) => { const classified = items.filter((item) => this.statsOutcome(item, threshold) !== 'unclassified'), wins = classified.filter((item) => this.statsOutcome(item, threshold) === 'win'), pnl = items.reduce((sum, item) => sum + item.realizedPnl, 0), oneLotPnls = items.map((item) => this.statsOneLotPnl(item)).filter((value): value is number => value !== undefined); return { key, label: this.statsDimensionLabel(dimension, key), count: items.length, classifiedCount: classified.length, ...(classified.filter((item) => this.statsOutcome(item, threshold) !== 'breakeven').length ? { winRate: wins.length / classified.filter((item) => this.statsOutcome(item, threshold) !== 'breakeven').length * 100 } : {}), realizedPnl: pnl, ...(oneLotPnls.length ? { oneLotPnl: oneLotPnls.reduce((sum, value) => sum + value, 0) / oneLotPnls.length } : {}), sufficiency: items.length < 10 ? '1-9' : items.length < 30 ? '10-29' : '30+' }; });
  }
  private statsFilterOptions(samples: StatsSample[], dimensions: TradeStatsDimension[], threshold: number, timeZone: string): NonNullable<TradeStatsResponse['filterOptions']> {
    return Object.fromEntries(dimensions.map((dimension) => [dimension, this.statsBreakdown(samples, dimension, threshold, timeZone)
      .filter(({ key }) => key !== 'unspecified' && key !== 'unevaluated')
      .map(({ key, label }) => ({ key, label }))]));
  }
  private statsPerformanceGroups(samples: StatsSample[], dimensions: TradeStatsDimension[], threshold: number, timeZone: string, query: TradeStatsQuery): TradeStatsResponse['performanceGroups'] {
    if (!dimensions.length) return [];
    const queryValues: Partial<Record<TradeStatsDimension, string[] | undefined>> = {
      symbol: query.symbols,
      side: query.sides,
      exitReason: query.exitReasons,
      entryWeekday: query.entryWeekdays,
      session: query.sessions,
      baseTimeframe: query.baseTimeframes,
      bollingerSetup: query.bollingerSetups,
      executionEvaluation: query.evaluations,
      violationFlags: query.violations,
      holdDuration: query.holdDurationBands,
      analysisCompleteness: query.analysisCompleteness,
    };
    const dimensionKeys = dimensions.map((dimension) => {
      const requested = queryValues[dimension];
      const keys = requested?.length ? requested : [...new Set(samples.flatMap((sample) => this.statsDimension(sample, dimension, timeZone)))];
      return [...keys].filter((key) => key !== 'unspecified' && key !== 'unevaluated').sort((left, right) => this.statsDimensionCompare(dimension, left, right));
    });
    if (dimensionKeys.some((keys) => !keys.length)) return [];
    const combinations = dimensionKeys.reduce<string[][]>((rows, keys) => rows.flatMap((row) => keys.map((key) => [...row, key])), [[]]);
    return combinations.map((keys) => {
      const items = samples.filter((sample) => keys.every((key, index) => this.statsDimension(sample, dimensions[index], timeZone).includes(key)));
      const overview = this.statsOverview(items, threshold);
      const points = items.map((item) => this.statsOneLotPnl(item)).filter((value): value is number => value !== undefined);
      return {
        key: keys.join('|'),
        labels: keys.map((key, index) => this.statsDimensionLabel(dimensions[index], key)),
        predicates: keys.map((key, index) => ({ dimension: dimensions[index], key })),
        count: items.length,
        classifiedCount: overview.classifiedCount,
        winRate: overview.winRate ?? 0,
        totalPnl: overview.totalRealizedPnl,
        averagePnl: overview.averageRealizedPnl,
        averagePoint: points.length ? points.reduce((sum, value) => sum + value, 0) / points.length : 0,
      };
    });
  }
  private statsSeriesByGranularity(samples: StatsSample[], preferences: TradeStatsPreferences, query: TradeStatsQuery): TradeStatsResponse['timeSeries'] {
    const toSeries = (granularity: TradeStatsGranularity, groups: Map<string, StatsSample[]>, keys: string[], labels?: Map<string, string>, timestamps?: Map<string, number>) => {
      let equity = 0, oneLotPnl = 0, wins = 0, losses = 0;
      const points = keys.map((key) => {
        const items = groups.get(key) ?? [];
        const realizedPnl = items.reduce((sum, item) => sum + item.realizedPnl, 0);
        const oneLotRealizedPnl = items.reduce((sum, item) => sum + (this.statsOneLotPnl(item) ?? 0), 0);
        equity += realizedPnl;
        oneLotPnl += oneLotRealizedPnl;
        for (const item of items) {
          const outcome = this.statsOutcome(item, preferences.breakevenPercent);
          if (outcome === 'win') wins += 1;
          if (outcome === 'loss') losses += 1;
        }
        const fallbackTimestamp = Date.parse(`${key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key}T00:00:00.000Z`);
        return { key, label: labels?.get(key) ?? key, timestamp: timestamps?.get(key) ?? fallbackTimestamp, count: items.length, realizedPnl, equity, oneLotPnl, ...((wins + losses) > 0 ? { winRate: wins / (wins + losses) * 100 } : {}) };
      });
      const active = points.filter((point) => point.count > 0);
      return { granularity, points, activeBucketAverage: active.length ? active.reduce((sum, point) => sum + point.realizedPnl, 0) / active.length : 0, calendarBucketAverage: points.length ? points.reduce((sum, point) => sum + point.realizedPnl, 0) / points.length : 0 };
    };
    const calendarSeries = (granularity: 'day' | 'week' | 'month' | 'year') => {
      const groups = new Map<string, StatsSample[]>();
      for (const sample of samples) {
        const key = this.statsPeriodKey(sample.closedAt, preferences, granularity);
        groups.set(key, [...(groups.get(key) ?? []), sample]);
      }
      const sampleKeys = [...groups.keys()].sort();
      return toSeries(granularity, groups, this.statsRangeKeys(query, preferences, granularity, sampleKeys));
    };
    const ordered = [...samples].sort((left, right) => left.closedAt.localeCompare(right.closedAt) || left.id.localeCompare(right.id));
    const sequenceGroups = new Map<string, StatsSample[]>();
    const sequenceLabels = new Map<string, string>();
    const sequenceTimestamps = new Map<string, number>();
    for (const sample of ordered) {
      const closedMinute = new Date(Math.floor(Date.parse(sample.closedAt) / 60000) * 60000);
      const key = closedMinute.toISOString();
      sequenceGroups.set(key, [...(sequenceGroups.get(key) ?? []), sample]);
      sequenceTimestamps.set(key, closedMinute.getTime());
    }
    const sequenceKeys = [...sequenceGroups.keys()].sort();
    sequenceKeys.forEach((key, index) => {
      const closedAt = new Date(sequenceTimestamps.get(key)!);
      const closedLabel = new Intl.DateTimeFormat('ko-KR', { timeZone: preferences.timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(closedAt);
      sequenceLabels.set(key, `${index + 1} · ${closedLabel}`);
    });
    return { sequence: toSeries('sequence', sequenceGroups, sequenceKeys, sequenceLabels, sequenceTimestamps), day: calendarSeries('day'), week: calendarSeries('week'), month: calendarSeries('month'), year: calendarSeries('year') };
  }
  private statsPeriodKey(closedAt: string, preferences: TradeStatsPreferences, granularity: 'day' | 'week' | 'month' | 'year'): string {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: preferences.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(closedAt)).map((part) => [part.type, part.value]));
    const localMinutes = Number(parts.hour) * 60 + Number(parts.minute);
    const localDate = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
    if (localMinutes < preferences.tradingDayStartMinutes) localDate.setUTCDate(localDate.getUTCDate() - 1);
    const day = localDate.toISOString().slice(0, 10);
    if (granularity === 'day') return day;
    if (granularity === 'month') return day.slice(0, 7);
    if (granularity === 'year') return day.slice(0, 4);
    localDate.setUTCDate(localDate.getUTCDate() - ((localDate.getUTCDay() || 7) - 1));
    return localDate.toISOString().slice(0, 10);
  }
  private statsRangeKeys(query: TradeStatsQuery, _preferences: TradeStatsPreferences, granularity: 'day' | 'week' | 'month' | 'year', sampleKeys: string[]): string[] {
    const dateOnly = (value?: string) => value?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
    const periodFromLocalDate = (day: string) => {
      if (granularity === 'month') return day.slice(0, 7);
      if (granularity === 'year') return day.slice(0, 4);
      if (granularity === 'day') return day;
      const date = new Date(`${day}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() || 7) - 1));
      return date.toISOString().slice(0, 10);
    };
    const from = dateOnly(query.from);
    const to = dateOnly(query.to);
    if (!from && !to) return sampleKeys;
    const first = from ?? sampleKeys[0] ?? to!;
    const last = to ?? sampleKeys.at(-1) ?? from!;
    const start = periodFromLocalDate(first);
    const end = periodFromLocalDate(last);
    const keys: string[] = [];
    let current = start;
    while (current <= end) {
      keys.push(current);
      current = this.nextStatsPeriodKey(current, granularity);
    }
    return keys;
  }
  private nextStatsPeriodKey(key: string, granularity: 'day' | 'week' | 'month' | 'year'): string { const value = new Date(`${key}${granularity === 'year' ? '-01-01' : granularity === 'month' ? '-01' : ''}T00:00:00.000Z`); if (granularity === 'day') value.setUTCDate(value.getUTCDate() + 1); else if (granularity === 'week') value.setUTCDate(value.getUTCDate() + 7); else if (granularity === 'month') value.setUTCMonth(value.getUTCMonth() + 1); else value.setUTCFullYear(value.getUTCFullYear() + 1); return granularity === 'year' ? String(value.getUTCFullYear()) : granularity === 'month' ? value.toISOString().slice(0, 7) : value.toISOString().slice(0, 10); }
  private statsCrosstab(samples: StatsSample[], threshold: number, rowDimension: TradeStatsDimension, columnDimension: TradeStatsDimension, timeZone: string): Pick<TradeStatsResponse['crosstab'], 'columns' | 'rows'> {
    const columns = [...new Set(samples.flatMap((sample) => this.statsDimension(sample, columnDimension, timeZone)))].sort();
    const rows = [...new Set(samples.flatMap((sample) => this.statsDimension(sample, rowDimension, timeZone)))].sort().map((rowKey) => {
      const rowItems = samples.filter((sample) => this.statsDimension(sample, rowDimension, timeZone).includes(rowKey));
      return { key: rowKey, label: rowKey, predicate: { dimension: rowDimension, key: rowKey }, cells: columns.map((columnKey) => ({ ...this.statsBreakdown(rowItems.filter((sample) => this.statsDimension(sample, columnDimension, timeZone).includes(columnKey)), columnDimension, threshold, timeZone).find((cell) => cell.key === columnKey) ?? { key: columnKey, label: columnKey, count: 0, classifiedCount: 0, realizedPnl: 0, sufficiency: '1-9' as const }, predicates: [{ dimension: rowDimension, key: rowKey }, { dimension: columnDimension, key: columnKey }] })) };
    });
    return { columns: columns.map((key) => ({ key, label: key, predicate: { dimension: columnDimension, key } })), rows };
  }
  private statsDrawdown(samples: StatsSample[], rs: number[]): TradeStatsResponse['drawdown'] {
    let equity = 0, peak = 0, money = 0, cumulativeR = 0, peakR = 0, drawdownR = 0, performanceIndex = 1, performancePeak = 1, percent: number | undefined;
    for (const sample of [...samples].sort((left, right) => left.closedAt.localeCompare(right.closedAt) || left.id.localeCompare(right.id))) {
      equity += sample.realizedPnl;
      peak = Math.max(peak, equity);
      money = Math.min(money, equity - peak);
      if (sample.seedBalance && sample.seedBalance > 0) {
        performanceIndex *= 1 + sample.realizedPnl / sample.seedBalance;
        performancePeak = Math.max(performancePeak, performanceIndex);
        percent = Math.min(percent ?? 0, (performanceIndex - performancePeak) / performancePeak * 100);
      }
      if (sample.riskAmount && sample.riskAmount > 0) { cumulativeR += sample.realizedPnl / sample.riskAmount; peakR = Math.max(peakR, cumulativeR); drawdownR = Math.min(drawdownR, cumulativeR - peakR); }
    }
    return { ...(samples.length ? { money } : {}), ...(percent !== undefined ? { percent } : {}), ...(rs.length ? { r: drawdownR } : {}) };
  }

  private async lockCampaignRows(tx: Tx, campaignId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "trade_campaigns" WHERE "id" = ${campaignId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "campaign_memberships" WHERE "campaign_id" = ${campaignId} FOR UPDATE`;
  }

  private async orderedCampaignMembers(tx: Tx, campaignId: string, accountId: string) {
    const members = await tx.campaignMembership.findMany({
      where: { campaignId },
      include: { trade: { select: { id: true, openedAt: true, closedAt: true, mt5PositionId: true } } },
    });
    return this.orderMemberships(tx, accountId, members);
  }

  private async orderedAccountMembers(tx: Tx, ownerId: string, accountId: string) {
    const members = await tx.campaignMembership.findMany({
      where: { trade: { ownerId, mt5AccountId: accountId, openedAt: { not: null } } },
      include: { trade: { select: { id: true, openedAt: true, closedAt: true, mt5PositionId: true } } },
    });
    return this.orderMemberships(tx, accountId, members);
  }

  private async orderMemberships<T extends { tradeId: string; trade: { openedAt: Date | null; mt5PositionId: bigint | null } }>(tx: Tx, accountId: string, members: T[]): Promise<T[]> {
    const positionIds = members.map((member) => member.trade.mt5PositionId).filter((id): id is bigint => id !== null);
    const deals = positionIds.length ? await tx.mt5Deal.findMany({
      where: { accountId, positionId: { in: positionIds }, entry: 0, type: { in: [0, 1] } },
      orderBy: [{ timeMsc: 'asc' }, { ticket: 'asc' }],
      select: { positionId: true, timeMsc: true, ticket: true },
    }) : [];
    const opening = new Map<string, { timeMsc: bigint; ticket: bigint }>();
    for (const deal of deals) if (!opening.has(deal.positionId.toString())) opening.set(deal.positionId.toString(), deal);
    return [...members].sort((left, right) => {
      const leftKey = left.trade.mt5PositionId === null ? undefined : opening.get(left.trade.mt5PositionId.toString());
      const rightKey = right.trade.mt5PositionId === null ? undefined : opening.get(right.trade.mt5PositionId.toString());
      const leftTime = leftKey?.timeMsc ?? BigInt(left.trade.openedAt?.getTime() ?? 0);
      const rightTime = rightKey?.timeMsc ?? BigInt(right.trade.openedAt?.getTime() ?? 0);
      if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
      const leftTicket = leftKey?.ticket ?? left.trade.mt5PositionId ?? 0n;
      const rightTicket = rightKey?.ticket ?? right.trade.mt5PositionId ?? 0n;
      if (leftTicket !== rightTicket) return leftTicket < rightTicket ? -1 : 1;
      const leftPosition = left.trade.mt5PositionId ?? 0n;
      const rightPosition = right.trade.mt5PositionId ?? 0n;
      if (leftPosition !== rightPosition) return leftPosition < rightPosition ? -1 : 1;
      return left.tradeId.localeCompare(right.tradeId);
    });
  }

  private partitionCampaignRange<T extends { headSource: string; trade: { openedAt: Date | null; closedAt: Date | null } }>(members: T[]): T[][] {
    const groups: T[][] = [];
    let group: T[] = [];
    let end = Number.NEGATIVE_INFINITY;
    for (const member of members) {
      const opened = member.trade.openedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      if (group.length && (member.headSource === 'MANUAL' || opened > end)) {
        groups.push(group);
        group = [];
        end = Number.NEGATIVE_INFINITY;
      }
      group.push(member);
      end = member.trade.closedAt ? Math.max(end, member.trade.closedAt.getTime()) : Number.POSITIVE_INFINITY;
    }
    if (group.length) groups.push(group);
    return groups;
  }

  private connectedAutomaticComponent<T extends { headSource: string; trade: { openedAt: Date | null; closedAt: Date | null } }>(members: T[], targetIndex: number): T[] {
    let start = targetIndex;
    let frontier = Number.NEGATIVE_INFINITY;
    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      const member = members[index];
      start = index;
      if (member.headSource === 'MANUAL') break;
    }
    let component: T[] = [];
    for (let index = start; index < members.length; index += 1) {
      const member = members[index];
      const opened = member.trade.openedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      if (component.length && (member.headSource === 'MANUAL' || opened > frontier)) {
        if (component.includes(members[targetIndex])) return component;
        component = [];
        frontier = Number.NEGATIVE_INFINITY;
      }
      component.push(member);
      frontier = member.trade.closedAt ? Math.max(frontier, member.trade.closedAt.getTime()) : Number.POSITIVE_INFINITY;
    }
    return component.includes(members[targetIndex]) ? component : [];
  }

  private async recomputeCampaignGaps(tx: Tx, campaignId: string, ownerId: string, accountId: string, affectedTradeId: string): Promise<string> {
    const members = await this.orderedCampaignMembers(tx, campaignId, accountId);
    const groups = this.partitionCampaignRange(members);
    let affectedCampaignId = groups[0]?.some((member) => member.tradeId === affectedTradeId) ? campaignId : '';
    for (const group of groups.slice(1)) {
      const root = group[0];
      const created = await tx.tradeCampaign.create({
        data: { rootTradeId: root.tradeId, tradingDate: this.seoulMidnight(root.trade.openedAt!), ownerId, mt5AccountId: accountId, analysis: { create: {} } },
      });
      await tx.campaignMembership.updateMany({
        where: { tradeId: { in: group.map((member) => member.tradeId) } },
        data: { campaignId: created.id, headSource: 'AUTO' },
      });
      await tx.campaignMembership.update({
        where: { tradeId: root.tradeId },
        data: root.headSource === 'MANUAL' ? { source: 'MANUAL', headSource: 'MANUAL' } : { source: 'AUTO', headSource: 'AUTO' },
      });
      await this.normalizeCampaign(tx, created.id);
      if (group.some((member) => member.tradeId === affectedTradeId)) affectedCampaignId = created.id;
    }
    if (groups.length > 1) await tx.tradeCampaign.update({ where: { id: campaignId }, data: { version: { increment: 1 } } });
    return affectedCampaignId || campaignId;
  }

  private hasCampaignAnalysisContent(analysis: CampaignWithRelations['analysis'] | null): boolean {
    if (!analysis) return false;
    return analysis.economicIndicators.length > 0
      || analysis.primaryTrend !== null
      || JSON.stringify(analysis.maTimeframes) !== '{}'
      || analysis.marketZoneEnabled || analysis.marketZoneHigh !== null || analysis.marketZoneLow !== null
      || analysis.retailPositionEnabled || analysis.retailBuyAveragePrice !== null || analysis.retailSellAveragePrice !== null || analysis.retailBuyRatio !== null
      || analysis.fibonacciEnabled || analysis.fibonacciStartPrice !== null || analysis.fibonacciEndPrice !== null
      || analysis.entryReason !== null || analysis.invalidationCondition !== null || analysis.takeProfitCondition !== null || analysis.additionalEntryPlan !== null
      || analysis.tradeScore !== null || analysis.strengths !== null || analysis.weaknesses !== null;
  }

  private async preserveCampaignMerge(tx: Tx, winnerId: string, loserId: string): Promise<void> {
    const [winner, loser] = await Promise.all([
      tx.tradeCampaign.findUniqueOrThrow({ where: { id: winnerId }, include: { analysis: true } }),
      tx.tradeCampaign.findUniqueOrThrow({ where: { id: loserId }, include: { analysis: { include: { economicIndicators: true, archives: true } } } }),
    ]);
    const winnerAnalysis = winner.analysis ?? await tx.tradeCampaignAnalysis.create({ data: { campaignId: winnerId } });
    if (loser.memo || loser.analysis) {
      await tx.tradeCampaignAnalysisArchive.upsert({
        where: { campaignAnalysisId_source: { campaignAnalysisId: winnerAnalysis.id, source: `campaign-merge:${loserId}` } },
        create: { campaignAnalysisId: winnerAnalysis.id, source: `campaign-merge:${loserId}`, content: JSON.parse(JSON.stringify({ campaignId: loserId, memo: loser.memo, analysis: loser.analysis })) },
        update: {},
      });
    }
    if (loser.memo) await tx.tradeCampaign.update({ where: { id: winnerId }, data: { memo: winner.memo ? `${winner.memo}\n\n[병합된 캠페인 ${loserId}]\n${loser.memo}` : loser.memo } });
    const offset = await tx.tradeCampaignImage.count({ where: { campaignId: winnerId } });
    const images = await tx.tradeCampaignImage.findMany({ where: { campaignId: loserId }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true } });
    for (const [index, image] of images.entries()) await tx.tradeCampaignImage.update({ where: { id: image.id }, data: { campaignId: winnerId, position: offset + index } });
    const conflicts = await tx.campaignConflict.findMany({ where: { OR: [{ resolvedCampaignId: loserId }, { candidateCampaignIds: { array_contains: [loserId] } }] } });
    for (const conflict of conflicts) {
      const candidateCampaignIds = Array.isArray(conflict.candidateCampaignIds) ? [...new Set(conflict.candidateCampaignIds.map((id) => id === loserId ? winnerId : id))] : [];
      await tx.campaignConflict.update({ where: { id: conflict.id }, data: { candidateCampaignIds, ...(conflict.resolvedCampaignId === loserId ? { resolvedCampaignId: winnerId } : {}) } });
    }
    await tx.tradeCampaignAnalysis.deleteMany({ where: { campaignId: loserId } });
  }

  private async serializedCampaign(tx: Tx, campaignId: string): Promise<TradeCampaign> {
    const campaign = await tx.tradeCampaign.findUniqueOrThrow({ where: { id: campaignId }, include: campaignWithRelations.include });
    const ordered = await this.orderCampaignForSerialization(tx, campaign);
    const preferences = this.serializeStatsPreferences(await tx.statisticsPreference.upsert({ where: { userId: campaign.ownerId }, create: { userId: campaign.ownerId }, update: {} }));
    return this.serializeCampaign(
      ordered,
      await this.loadProvenEntryBalanceMap([campaign.rootTrade, ...campaign.memberships.map((member) => member.trade)]),
      this.campaignJournalDate(ordered, preferences),
    );
  }

  private async orderCampaignForSerialization(client: Tx | PrismaService, campaign: CampaignWithRelations): Promise<CampaignWithRelations> {
    if (!campaign.mt5AccountId) return campaign;
    return { ...campaign, memberships: await this.orderMemberships(client as Tx, campaign.mt5AccountId, campaign.memberships) };
  }

  private async prepareCampaignForMemberMove(tx: Tx, campaignId: string, tradeId: string): Promise<void> {
    await tx.campaignMembership.updateMany({ where: { campaignId }, data: { source: 'MANUAL' } });
    const remaining = await tx.campaignMembership.findMany({
      where: { campaignId, tradeId: { not: tradeId } },
      include: { trade: { select: { openedAt: true, mt5PositionId: true } } },
      orderBy: [{ trade: { openedAt: 'asc' } }, { trade: { mt5PositionId: 'asc' } }, { tradeId: 'asc' }],
    });
    if (!remaining.length) {
      await tx.campaignMembership.delete({ where: { tradeId } });
      await tx.tradeCampaign.delete({ where: { id: campaignId } });
      await this.pruneCampaignConflictCandidates(tx, campaignId);
      return;
    }
    const root = remaining.find((member) => member.trade.openedAt);
    if (!root) throw new BadRequestException('Campaign members require openedAt');
    await tx.tradeCampaign.update({ where: { id: campaignId }, data: { rootTradeId: root.tradeId, tradingDate: this.seoulMidnight(root.trade.openedAt!), version: { increment: 1 } } });
  }

  private async relinkCampaignInTransaction(tx: Tx, tradeId: string, campaignId: string, prepareSource = true): Promise<void> {
    const campaign = await tx.tradeCampaign.findUnique({ where: { id: campaignId }, include: { rootTrade: true } });
    if (!campaign) throw new NotFoundException(`Campaign ${campaignId} not found`);
    const trade = await this.findTrade(tx, campaign.ownerId, campaign.mt5AccountId ?? undefined, tradeId);
    if (campaign.ownerId !== trade.ownerId || campaign.mt5AccountId !== trade.mt5AccountId || campaign.rootTrade.symbol !== trade.symbol || campaign.rootTrade.side !== trade.side) throw new BadRequestException('Campaign is incompatible with trade owner, account, symbol, or side');
    const previous = await tx.campaignMembership.findUnique({ where: { tradeId } });
    if (prepareSource && previous && previous.campaignId !== campaignId) await this.prepareCampaignForMemberMove(tx, previous.campaignId, tradeId);
    await tx.campaignMembership.upsert({ where: { tradeId }, create: { tradeId, campaignId, source: 'MANUAL' }, update: { campaignId, source: 'MANUAL' } });
    await tx.tradeCampaign.update({ where: { id: campaignId }, data: { version: { increment: 1 } } });
    await this.normalizeCampaign(tx, campaignId);
  }

  private async normalizeCampaign(tx: Tx, campaignId: string): Promise<void> {
    const campaign = await tx.tradeCampaign.findUnique({ where: { id: campaignId }, select: { mt5AccountId: true } });
    if (!campaign?.mt5AccountId) throw new BadRequestException('Campaign requires an MT5 account');
    const members = await tx.campaignMembership.findMany({
      where: { campaignId },
      include: { trade: { select: { id: true, openedAt: true, mt5PositionId: true, mt5AccountId: true } } },
    });
    if (!members.length) {
      await tx.tradeCampaign.delete({ where: { id: campaignId } });
      await this.pruneCampaignConflictCandidates(tx, campaignId);
      return;
    }
    const root = (await this.orderMemberships(tx, campaign.mt5AccountId, members)).find((member) => member.trade.openedAt);
    if (!root) return;
    await tx.tradeCampaign.update({ where: { id: campaignId }, data: { rootTradeId: root.tradeId, tradingDate: this.seoulMidnight(root.trade.openedAt!), version: { increment: 1 } } });
  }

  private async pruneCampaignConflictCandidates(tx: Tx, campaignId: string): Promise<void> {
    const conflicts = await tx.campaignConflict.findMany({
      where: { status: 'UNRESOLVED', candidateCampaignIds: { array_contains: [campaignId] } },
    });
    for (const conflict of conflicts) {
      const candidates = Array.isArray(conflict.candidateCampaignIds)
        ? conflict.candidateCampaignIds.filter((candidate): candidate is string => typeof candidate === 'string' && candidate !== campaignId)
        : [];
      await tx.campaignConflict.update({
        where: { id: conflict.id },
        data: candidates.length >= 2
          ? { candidateCampaignIds: candidates }
          : { candidateCampaignIds: candidates, status: 'RESOLVED', resolvedCampaignId: candidates[0] ?? null, resolvedAt: new Date() },
      });
    }
  }


  private seoulDate(value: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  private seoulMidnight(value: Date): Date { return new Date(`${this.seoulDate(value)}T00:00:00.000Z`); }
  private async ownerScope(ownerId: string, input: TradeScopeInput): Promise<{ ownerId: string; mt5AccountId: string }> {
    if (!input.accountId) throw new BadRequestException('accountId is required');
    const account = await this.prisma.mt5Account.findFirst({ where: { id: input.accountId, ownerId }, select: { id: true } });
    if (!account) throw new ForbiddenException('Account is unavailable');
    return { ownerId, mt5AccountId: account.id };
  }

  private async findTrade(client: PrismaService | Tx, ownerId: string, accountId: string | undefined, id: string): Promise<TradeWithRelations> {
    if (!accountId) throw new BadRequestException('accountId is required');
    const trade = await client.trade.findFirst({ where: { id, ownerId, mt5AccountId: accountId }, ...tradeWithRelations });
    if (!trade) throw new NotFoundException(`Trade ${id} not found`);
    return trade;
  }
  private canonicalizeDisabledGroups(request: PatchTradeCampaignAnalysisRequest, data: Record<string, unknown>): void {
    const groups: Array<[keyof PatchTradeCampaignAnalysisRequest, Array<keyof PatchTradeCampaignAnalysisRequest>]> = [
      ['marketZoneEnabled', ['marketZoneHigh', 'marketZoneLow']],
      ['retailPositionEnabled', ['retailBuyAveragePrice', 'retailSellAveragePrice', 'retailBuyRatio']],
      ['fibonacciEnabled', ['fibonacciStartPrice', 'fibonacciEndPrice']],
    ];
    for (const [flag, details] of groups) {
      if (request[flag] !== false) continue;
      if (details.some((detail) => request[detail] !== undefined && request[detail] !== null)) {
        throw new BadRequestException(`${String(flag)} false requires its details to be null`);
      }
      for (const detail of details) data[detail] = null;
    }
  }
  private canonicalizeAndValidate(analysis: Record<string, unknown>): void {
    const group = (enabled: string, fields: string[]) => {
      if (!analysis[enabled] && fields.some((field) => analysis[field] != null)) {
        throw new BadRequestException(`${enabled} false requires its details to be null`);
      }
      if (analysis[enabled] && fields.some((field) => analysis[field] == null)) {
        throw new BadRequestException(`${enabled} requires all details`);
      }
    };
    group('marketZoneEnabled', ['marketZoneHigh', 'marketZoneLow']);
    group('retailPositionEnabled', ['retailBuyAveragePrice', 'retailSellAveragePrice', 'retailBuyRatio']);
    group('fibonacciEnabled', ['fibonacciStartPrice', 'fibonacciEndPrice']);
    if (analysis.marketZoneEnabled && Number(analysis.marketZoneHigh) <= Number(analysis.marketZoneLow)) throw new BadRequestException('marketZoneHigh must exceed marketZoneLow');
    if (analysis.fibonacciEnabled && Number(analysis.fibonacciStartPrice) === Number(analysis.fibonacciEndPrice)) throw new BadRequestException('fibonacci endpoints must differ');
  }
  private campaignJournalDate(campaign: CampaignWithRelations, preferences: TradeStatsPreferences): string {
    const closedAt = campaign.memberships.map((membership) => membership.trade.closedAt);
    const timestamp = closedAt.every((value): value is Date => value !== null)
      ? new Date(Math.max(...closedAt.map((value) => value.getTime())))
      : new Date(Math.min(...campaign.memberships.map((membership) => membership.trade.openedAt?.getTime() ?? Number.POSITIVE_INFINITY)));
    return this.statsPeriodKey(timestamp.toISOString(), preferences, 'day');
  }
  private serializeCampaign(campaign: CampaignWithRelations, provenBalances = new Map<string, Prisma.Decimal>(), journalDate?: string): TradeCampaign {
    if (!campaign.analysis) throw new Error(`Campaign ${campaign.id} lacks analysis`);
    const headSource = campaign.memberships.find((membership) => membership.tradeId === campaign.rootTradeId)?.headSource ?? 'AUTO';
    const root = this.serialize(campaign.rootTrade, provenBalances);
    const members = campaign.memberships.map((membership) => this.serialize(membership.trade, provenBalances));
    const firstOpened = [...members]
      .filter((trade) => trade.openedAt !== undefined)
      .sort((left, right) => new Date(left.openedAt!).getTime() - new Date(right.openedAt!).getTime())[0];
    const quantity = members.reduce((sum: number, trade: TradeRecord) => sum + (trade.quantityLots ?? 0), 0);
    const exited = members.reduce((sum: number, trade: TradeRecord) => sum + (trade.exit?.quantity ?? 0), 0);
    const weighted = (items: TradeRecord[], value: 'entryPrice' | 'exitPrice', quantityOf: (trade: TradeRecord) => number) => {
      const total = items.reduce((sum, trade) => sum + quantityOf(trade), 0);
      return total ? items.reduce((sum, trade) => sum + (trade[value] ?? 0) * quantityOf(trade), 0) / total : undefined;
    };
    const open = members.some((trade: TradeRecord) => trade.status === 'open');
    let closedAt: Date | undefined;
    if (!open) {
      for (const trade of members) {
        const value = trade.closedAt ? new Date(trade.closedAt) : undefined;
        if (value && (!closedAt || value > closedAt)) closedAt = value;
      }
    }

    const latestClosedWithReason = members
      .filter((trade) => trade.closedAt !== undefined && trade.exitReason !== undefined)
      .sort((left, right) => new Date(right.closedAt!).getTime() - new Date(left.closedAt!).getTime())[0];
    return {
      id: campaign.id,
      rootTradeId: campaign.rootTradeId,
      campaignVersion: campaign.version,
      headSource,
      tradingDate: journalDate ?? this.seoulDate(campaign.tradingDate),
      accountId: campaign.mt5AccountId!,
      symbol: root.symbol,
      side: root.side,
      status: open ? 'open' : 'closed',
      entryPrice: weighted(members, 'entryPrice', (trade) => trade.quantityLots ?? 0),
      exitPrice: weighted(members, 'exitPrice', (trade) => trade.exit?.quantity ?? 0),
      quantityLots: quantity,
      remainingQuantityLots: quantity - exited,
      exitReason: latestClosedWithReason?.exitReason,
      realizedPnl: members.reduce((sum: number, trade: TradeRecord) => sum + (trade.realizedPnl ?? 0), 0),
      openedAt: firstOpened?.openedAt ?? root.openedAt!,
      closedAt: closedAt?.toISOString(),
      seedBalance: firstOpened?.seedBalance,

      images: campaign.images.map((image) => ({
        id: image.id,
        campaignId: image.campaignId,
        position: image.position,
        mimeType: image.mimeType,
        byteSize: image.byteSize,
        width: image.width,
        height: image.height,
        originalName: image.originalName ?? undefined,
        createdAt: image.createdAt.toISOString(),
        updatedAt: image.updatedAt.toISOString(),
      })),
      memo: campaign.memo ?? undefined,
      updatedAt: campaign.updatedAt.toISOString(),
      analysisComplete: members.every((member) => member.analysisComplete) && this.campaignAnalysisComplete(campaign.analysis),
      analysis: {
        schemaVersion: 1,
        primaryTrend: campaign.analysis.primaryTrend?.toLowerCase() as TradeCampaign['analysis']['primaryTrend'],
        maTimeframes: campaign.analysis.maTimeframes as TradeCampaign['analysis']['maTimeframes'],
        marketZoneEnabled: campaign.analysis.marketZoneEnabled,
        marketZoneHigh: campaign.analysis.marketZoneHigh === null ? undefined : Number(campaign.analysis.marketZoneHigh),
        marketZoneLow: campaign.analysis.marketZoneLow === null ? undefined : Number(campaign.analysis.marketZoneLow),
        retailPositionEnabled: campaign.analysis.retailPositionEnabled,
        retailBuyAveragePrice: campaign.analysis.retailBuyAveragePrice === null ? undefined : Number(campaign.analysis.retailBuyAveragePrice),
        retailSellAveragePrice: campaign.analysis.retailSellAveragePrice === null ? undefined : Number(campaign.analysis.retailSellAveragePrice),
        retailBuyRatio: campaign.analysis.retailBuyRatio === null ? undefined : Number(campaign.analysis.retailBuyRatio),
        fibonacciEnabled: campaign.analysis.fibonacciEnabled,
        fibonacciStartPrice: campaign.analysis.fibonacciStartPrice === null ? undefined : Number(campaign.analysis.fibonacciStartPrice),
        fibonacciEndPrice: campaign.analysis.fibonacciEndPrice === null ? undefined : Number(campaign.analysis.fibonacciEndPrice),
        economicIndicators: campaign.analysis.economicIndicators.map((indicator) => ({ id: indicator.id, type: indicator.type, impact: indicator.impact.toLowerCase() as 'positive' | 'negative', announcedAt: indicator.announcedAt?.toISOString(), position: indicator.position })),
        entryReason: campaign.analysis.entryReason ?? undefined,
        invalidationCondition: campaign.analysis.invalidationCondition ?? undefined,
        takeProfitCondition: campaign.analysis.takeProfitCondition ?? undefined,
        additionalEntryPlan: campaign.analysis.additionalEntryPlan ?? undefined,
        tradeScore: campaign.analysis.tradeScore ?? undefined,
        strengths: campaign.analysis.strengths ?? undefined,
        weaknesses: campaign.analysis.weaknesses ?? undefined,
        reviewUpdatedAt: campaign.analysis.reviewUpdatedAt?.toISOString() ?? campaign.analysis.updatedAt.toISOString(),
        createdAt: campaign.analysis.createdAt.toISOString(),
        updatedAt: campaign.analysis.updatedAt.toISOString(),
      },
      members,
      conflicts: campaign.conflicts.map((conflict) => ({
        id: conflict.id,
        tradeId: conflict.tradeId,
        candidateCampaignIds: conflict.candidateCampaignIds as string[],
        status: conflict.status === 'RESOLVED' ? 'resolved' : 'unresolved',
        resolvedCampaignId: conflict.resolvedCampaignId ?? undefined,
        createdAt: conflict.createdAt.toISOString(),
        resolvedAt: conflict.resolvedAt?.toISOString(),
      })),
      excursion: campaign.excursionResult ? this.serializeCampaignExcursion(campaign.excursionResult) : undefined,
    };
  }
  private serializeExcursionSuccess(result: any) {
    const required = [
      'successCalculationVersion', 'successInputFingerprint', 'lastSucceededAt', 'rawFromMsc', 'rawToMsc',
      'displayFromAt', 'displayToAt', 'tickSnapshotToMsc', 'priceSource', 'pathDigest', 'tickCount', 'valuationVersion', 'valuationDigests',
    ];
    if (required.some((key) => result[key] === null || result[key] === undefined)) throw new Error('Excursion success result is missing persisted provenance');
    if (result.priceSource !== 'mt5_copy_ticks_range') throw new Error('Excursion success result has an unsupported persisted price source');
    const valuationDigests = result.valuationDigests;
    const accountCurrency = typeof valuationDigests === 'object' && valuationDigests !== null && typeof valuationDigests.accountCurrency === 'string'
      ? valuationDigests.accountCurrency
      : undefined;
    if (!accountCurrency) throw new Error('Excursion success result is missing account currency provenance');
    const valuationDigest = typeof valuationDigests === 'object' && valuationDigests !== null && typeof valuationDigests.digest === 'string'
      ? valuationDigests.digest
      : undefined;
    if (!valuationDigest) throw new Error('Excursion success result is missing valuation digest provenance');
    return {
      calculationVersion: result.successCalculationVersion,
      inputFingerprint: result.successInputFingerprint,
      succeededAt: result.lastSucceededAt.toISOString(),
      priceSource: result.priceSource,
      rawRange: { fromMsc: Number(result.rawFromMsc), toMsc: Number(result.rawToMsc) },
      displayRange: { fromAt: result.displayFromAt.toISOString(), toAt: result.displayToAt.toISOString() },
      tickSnapshotToMsc: Number(result.tickSnapshotToMsc),
      pathDigest: result.pathDigest,
      tickCount: result.tickCount,
      valuationVersion: result.valuationVersion,
      valuationDigest,
      accountCurrency,
    };
  }
  private serializeExcursion(result: any): TradeExcursionResult {
    const successfulAttempt = { calculationVersion: result.attemptCalculationVersion, inputFingerprint: result.attemptInputFingerprint, attemptedAt: result.lastAttemptedAt.toISOString() };
    const failedAttempt = () => {
      if (!result.failureReason) throw new Error('Excursion failed attempt is missing a failure reason');
      return { ...successfulAttempt, failureReason: publicExcursionFailureReason(result.failureReason) };
    };
    const attempt = result.status === 'SUCCESS' ? successfulAttempt : failedAttempt();
    if (result.status === 'FAILED' || result.status === 'UNSUPPORTED') return { scope: 'trade', status: result.status.toLowerCase(), attempt } as TradeExcursionResult;
    const metricFields = ['mfePrice', 'mfePriceMarkPrice', 'mfePriceOccurredAt', 'maePrice', 'maePriceMarkPrice', 'maePriceOccurredAt', 'mfePercent', 'mfePercentMarkPrice', 'mfePercentOccurredAt', 'maePercent', 'maePercentMarkPrice', 'maePercentOccurredAt', 'mfeUnrealizedPnl', 'mfeUnrealizedPnlOccurredAt', 'maeUnrealizedPnl', 'maeUnrealizedPnlOccurredAt'];
    if (metricFields.some((key) => result[key] === null || result[key] === undefined)) throw new Error('Excursion success result is missing persisted metrics');
    if ((result.mfeR === null) !== (result.maeR === null) || (result.mfeR !== null && (result.mfeROccurredAt === null || result.maeROccurredAt === null))) throw new Error('Excursion success result has incomplete R metrics');
    const extremum = (value: any, occurredAt: Date, markPrice?: any) => markPrice === undefined ? { value: Number(value), occurredAt: occurredAt.toISOString() } : { value: Number(value), occurredAt: occurredAt.toISOString(), markPrice: Number(markPrice) };
    const priced = (mfe: any, mfeMark: any, mfeAt: Date, mae: any, maeMark: any, maeAt: Date) => ({ mfe: extremum(mfe, mfeAt, mfeMark), mae: extremum(mae, maeAt, maeMark) });
    const portfolio = (mfe: any, mfeAt: Date, mae: any, maeAt: Date) => ({ mfe: extremum(mfe, mfeAt), mae: extremum(mae, maeAt) });
    const metrics: any = { price: priced(result.mfePrice, result.mfePriceMarkPrice, result.mfePriceOccurredAt, result.maePrice, result.maePriceMarkPrice, result.maePriceOccurredAt), percent: priced(result.mfePercent, result.mfePercentMarkPrice, result.mfePercentOccurredAt, result.maePercent, result.maePercentMarkPrice, result.maePercentOccurredAt), unrealizedPnl: portfolio(result.mfeUnrealizedPnl, result.mfeUnrealizedPnlOccurredAt, result.maeUnrealizedPnl, result.maeUnrealizedPnlOccurredAt), ...(result.captureRate === null ? {} : { captureRate: Number(result.captureRate) }), rAvailability: result.mfeR === null || result.maeR === null ? 'risk_unavailable' : 'available' };
    if (metrics.rAvailability === 'available') metrics.r = portfolio(result.mfeR, result.mfeROccurredAt, result.maeR, result.maeROccurredAt);
    if (result.status !== 'SUCCESS' && result.status !== 'STALE') throw new Error(`Unsupported excursion status: ${result.status}`);
    return { scope: 'trade', status: result.status.toLowerCase(), attempt, success: this.serializeExcursionSuccess(result), metrics } as TradeExcursionResult;
  }
  private serializeCampaignExcursion(result: any): CampaignExcursionResult {
    const family = (name: 'price' | 'unrealizedPnl', status: string, reason: string | null) => {
      const unavailable = status === 'FAILED' || status === 'UNSUPPORTED';
      const successfulAttempt = { calculationVersion: result.attemptCalculationVersion, inputFingerprint: result.attemptInputFingerprint, attemptedAt: result.lastAttemptedAt.toISOString() };
      if (unavailable) {
        if (!reason) throw new Error('Campaign excursion failed family is missing a failure reason');
        return { family: name === 'price' ? 'campaign_price' : 'campaign_unrealized_pnl', status: status.toLowerCase(), attempt: { ...successfulAttempt, failureReason: publicExcursionFailureReason(reason) } };
      }
      if (status !== 'SUCCESS' && status !== 'STALE') throw new Error(`Unsupported campaign excursion status: ${status}`);
      if (status === 'STALE' && !reason) throw new Error('Campaign excursion stale family is missing a failure reason');
      const extremum = (value: any, occurredAt: Date, markPrice?: any) => markPrice === undefined ? { value: Number(value), occurredAt: occurredAt.toISOString() } : { value: Number(value), occurredAt: occurredAt.toISOString(), markPrice: Number(markPrice) };
      const priced = (mfe: any, mfeMark: any, mfeAt: Date, mae: any, maeMark: any, maeAt: Date) => ({ mfe: extremum(mfe, mfeAt, mfeMark), mae: extremum(mae, maeAt, maeMark) });
      const portfolio = (mfe: any, mfeAt: Date, mae: any, maeAt: Date) => ({ mfe: extremum(mfe, mfeAt), mae: extremum(mae, maeAt) });
      const required = name === 'price'
        ? ['mfePrice', 'mfePriceMarkPrice', 'mfePriceOccurredAt', 'maePrice', 'maePriceMarkPrice', 'maePriceOccurredAt', 'mfePercent', 'mfePercentMarkPrice', 'mfePercentOccurredAt', 'maePercent', 'maePercentMarkPrice', 'maePercentOccurredAt']
        : ['mfeUnrealizedPnl', 'mfeUnrealizedPnlOccurredAt', 'maeUnrealizedPnl', 'maeUnrealizedPnlOccurredAt'];
      if (required.some((key) => result[key] === null || result[key] === undefined)) {
        if (status !== 'STALE' || !reason) throw new Error(`Campaign excursion ${name} family is missing persisted metrics`);
        return { family: name === 'price' ? 'campaign_price' : 'campaign_unrealized_pnl', status: 'failed', attempt: { ...successfulAttempt, failureReason: publicExcursionFailureReason(reason) } };
      }
      if (name === 'unrealizedPnl' && ((result.mfeR === null) !== (result.maeR === null) || (result.mfeR !== null && (result.mfeROccurredAt === null || result.maeROccurredAt === null)))) throw new Error('Campaign excursion unrealized PnL family has incomplete R metrics');
      const metrics = name === 'price'
        ? { price: priced(result.mfePrice, result.mfePriceMarkPrice, result.mfePriceOccurredAt, result.maePrice, result.maePriceMarkPrice, result.maePriceOccurredAt), percent: priced(result.mfePercent, result.mfePercentMarkPrice, result.mfePercentOccurredAt, result.maePercent, result.maePercentMarkPrice, result.maePercentOccurredAt) }
        : {
          unrealizedPnl: portfolio(result.mfeUnrealizedPnl, result.mfeUnrealizedPnlOccurredAt, result.maeUnrealizedPnl, result.maeUnrealizedPnlOccurredAt),
          ...(result.captureRate === null ? {} : { captureRate: Number(result.captureRate) }),
          rAvailability: result.mfeR === null || result.maeR === null ? 'risk_unavailable' : 'available',
          ...(result.mfeR === null || result.maeR === null ? {} : { r: portfolio(result.mfeR, result.mfeROccurredAt, result.maeR, result.maeROccurredAt) }),
        };
      return { family: name === 'price' ? 'campaign_price' : 'campaign_unrealized_pnl', status: status.toLowerCase(), attempt: status === 'STALE' ? { ...successfulAttempt, failureReason: publicExcursionFailureReason(reason) } : successfulAttempt, success: this.serializeExcursionSuccess(result), metrics };
    };
    return { scope: 'campaign', price: family('price', result.priceFamilyStatus, result.priceFamilyReason), unrealizedPnl: family('unrealizedPnl', result.pnlFamilyStatus, result.pnlFamilyReason) } as CampaignExcursionResult;
  }
  private executionAnalysisComplete(analysis: TradeWithRelations['analysis']): boolean {
    if (!analysis?.baseTimeframe) return false;
    if (!analysis.bollingerBandCount && analysis.bollingerDirection) return false;
    if (analysis.bollingerBandCount && analysis.bollingerBandCount !== 'NO_TOUCH' && !analysis.bollingerDirection) return false;
    return true;
  }

  private campaignAnalysisComplete(analysis: NonNullable<CampaignWithRelations['analysis']>): boolean {
    if (!analysis?.primaryTrend) return false;
    const maTimeframes = (analysis.maTimeframes ?? {}) as Record<string, { arrangement?: string; cross20_60?: string; cross20_120?: string }>;
    if (['15m', '30m', '1h', '4h', '1D', '1W', '1MN'].some((timeframe) => {
      const reading = maTimeframes[timeframe];
      return !reading?.arrangement || !reading.cross20_60 || !reading.cross20_120;
    })) return false;
    if (analysis.marketZoneEnabled && (analysis.marketZoneHigh === null || analysis.marketZoneLow === null)) return false;
    if (analysis.retailPositionEnabled && (analysis.retailBuyAveragePrice === null || analysis.retailSellAveragePrice === null || analysis.retailBuyRatio === null)) return false;
    if (analysis.fibonacciEnabled && (analysis.fibonacciStartPrice === null || analysis.fibonacciEndPrice === null)) return false;
    return analysis.economicIndicators.every((indicator) => Boolean(indicator.type.trim()) && Boolean(indicator.impact));
  }
  private entryBalanceKey(trade: Pick<TradeWithRelations, 'mt5AccountId' | 'mt5ServerCanonical' | 'mt5AccountLogin' | 'mt5PositionId'>): string {
    return `${trade.mt5AccountId ?? ''}:${trade.mt5ServerCanonical ?? ''}:${trade.mt5AccountLogin?.toString() ?? ''}:${trade.mt5PositionId?.toString() ?? ''}`;
  }

  private async loadProvenEntryBalanceMap(trades: TradeWithRelations[], client: Pick<PrismaService, 'mt5PositionEntryBalance'> = this.prisma): Promise<Map<string, Prisma.Decimal>> {
    const candidates = trades.filter((trade) => trade.seedBalance !== null && trade.mt5AccountId && trade.mt5ServerCanonical && trade.mt5AccountLogin !== null && trade.mt5PositionId !== null);
    if (!candidates.length) return new Map();
    const rows = await client.mt5PositionEntryBalance.findMany({
      where: { state: 'PROVEN', OR: candidates.map((trade) => ({ accountId: trade.mt5AccountId!, server: trade.mt5ServerCanonical!, accountLogin: trade.mt5AccountLogin!, positionId: trade.mt5PositionId! })) },
      select: { accountId: true, server: true, accountLogin: true, positionId: true, preEntryBalance: true },
    });
    return new Map(rows.filter((row) => row.preEntryBalance !== null).map((row) => [`${row.accountId}:${row.server}:${row.accountLogin.toString()}:${row.positionId.toString()}`, row.preEntryBalance!]));
  }

  private serialize(trade: TradeWithRelations, provenBalances = new Map<string, Prisma.Decimal>()): TradeRecord {
    const analysis = trade.analysis;
    if (!analysis) throw new Error(`Trade ${trade.id} lacks analysis`);
    const optional = <T>(value: T | null): T | undefined => value ?? undefined;
    const decimal = (value: Prisma.Decimal | null): number | undefined => value === null ? undefined : Number(value);
    return {
      id: trade.id, accountId: trade.mt5AccountId!, mt5Server: optional(trade.mt5Server), symbol: trade.symbol, side: trade.side.toLowerCase() as 'long' | 'short',
      status: trade.status.toLowerCase() as TradeRecord['status'],
      analysisComplete: this.executionAnalysisComplete(analysis),
      thesis: optional(trade.thesis),
      entryRationale: optional(trade.entryRationale), exitRationale: optional(trade.exitRationale),
      takeProfitCriteria: optional(trade.takeProfitCriteria), stopLossCriteria: optional(trade.stopLossCriteria),
      note: optional(trade.note),
      accountCurrency: optional(trade.accountCurrency), quantityLots: decimal(trade.quantityLots),
      entryPrice: decimal(trade.entryPrice), exitPrice: decimal(trade.exitPrice),
      exitReason: optional(trade.exitReason) as TradeRecord['exitReason'], realizedPnl: decimal(trade.realizedPnl),
      ...(trade.seedBalance !== null && provenBalances.get(this.entryBalanceKey(trade))?.equals(trade.seedBalance)
        ? { seedBalance: decimal(trade.seedBalance) }
        : {}),
      ...((trade.initialPlan
        && trade.initialPlanId === trade.initialPlan.id
        && trade.initialPlanMetricContractVersion === trade.initialPlan.metricContractVersion
        || trade.initialPlanId === null
        && trade.initialPlanMetricContractVersion === null
        && trade.plannedTakeProfitPrice !== null
        && trade.plannedStopLossPrice !== null)
        && trade.riskPercent !== null
        && trade.riskAmount !== null
        && trade.returnPercent !== null
        ? {
          plannedTakeProfitPrice: decimal(trade.plannedTakeProfitPrice),
          riskAmount: decimal(trade.riskAmount),
          riskPercent: decimal(trade.riskPercent),
          plannedStopLossPrice: decimal(trade.plannedStopLossPrice),
          returnPercent: decimal(trade.returnPercent),
          rr: Number(trade.returnPercent) / Number(trade.riskPercent),
        }
        : {}),
      openedAt: trade.openedAt?.toISOString(), closedAt: trade.closedAt?.toISOString(),
      entry: trade.entry ? { price: Number(trade.entry.price), quantity: decimal(trade.entry.quantity), occurredAt: trade.entry.occurredAt.toISOString(), note: optional(trade.entry.note) } : undefined,
      exit: trade.exit ? { price: Number(trade.exit.price), quantity: decimal(trade.exit.quantity), occurredAt: trade.exit.occurredAt.toISOString(), reason: optional(trade.exit.reason) as TradeRecord['exitReason'], note: optional(trade.exit.note) } : undefined,
      analysis: {
        schemaVersion: 3,
        baseTimeframe: optional(analysis.baseTimeframe),
        bollingerBandCount: optional(analysis.bollingerBandCount)?.toLowerCase() as TradeRecord['analysis']['bollingerBandCount'],
        bollingerDirection: optional(analysis.bollingerDirection)?.toLowerCase() as TradeRecord['analysis']['bollingerDirection'],
        executionEvaluation: optional(analysis.executionEvaluation)?.toLowerCase() as TradeRecord['analysis']['executionEvaluation'],
        unplannedAdditionalEntry: analysis.unplannedAdditionalEntry,
        excessiveSize: analysis.excessiveSize,
        stopLossViolation: analysis.stopLossViolation,
        earlyExit: analysis.earlyExit,
        lateExit: analysis.lateExit,
        otherViolation: optional(analysis.otherViolation),
        createdAt: analysis.createdAt.toISOString(), updatedAt: analysis.updatedAt.toISOString(),
      },
      excursion: trade.excursionResult ? this.serializeExcursion(trade.excursionResult) : undefined,
      createdAt: trade.createdAt.toISOString(), updatedAt: trade.updatedAt.toISOString(),
    };
  }
}
