import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  HealthResponse,
  PatchTradeAnalysisRequest,
  PatchTradeCampaignAnalysisRequest,
  PatchTradeCampaignMemoRequest,
  PatchTradeCampaignReviewRequest,
  RelinkTradeCampaignRequest,
  ResolveCampaignConflictRequest,
  TradeCampaign,
  TradeCampaignDateResponse,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeRecord,
  TradeStatsResponse,
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
import { validateTradeAnalysisPatchRequest, validateTradeCampaignAnalysisPatchRequest, validateTradeCampaignReviewPatchRequest } from './trade-log.validation';
import { calculateExecutionBasedMetrics, calculateTradePlanMetrics } from './trade-plan-metrics';

export interface TradeScopeInput { accountId?: string; }

const tradeWithRelations = Prisma.validator<Prisma.TradeDefaultArgs>()({ include: { entry: true, exit: true, initialPlan: true, analysis: true } });
type TradeWithRelations = Prisma.TradeGetPayload<typeof tradeWithRelations>;
const campaignWithRelations = Prisma.validator<Prisma.TradeCampaignDefaultArgs>()({
  include: {
    analysis: { include: { economicIndicators: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } } },
    rootTrade: { include: tradeWithRelations.include },
    memberships: { include: { trade: { include: tradeWithRelations.include } }, orderBy: { createdAt: 'asc' } },
    conflicts: { orderBy: { createdAt: 'asc' } },
    images: { where: { publishedAt: { not: null } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] },
  },
});
type CampaignWithRelations = Prisma.TradeCampaignGetPayload<typeof campaignWithRelations>;
type Tx = Prisma.TransactionClient;
const analysisFields = ['baseTimeframe','bollingerBandCount','bollingerDirection','executionEvaluation','unplannedAdditionalEntry','excessiveSize','stopLossViolation','earlyExit','lateExit','otherViolation'] as const;
const campaignAnalysisFields = ['primaryTrend','maTimeframes','marketZoneEnabled','marketZoneHigh','marketZoneLow','retailPositionEnabled','retailBuyAveragePrice','retailSellAveragePrice','retailBuyRatio','fibonacciEnabled','fibonacciStartPrice','fibonacciEndPrice'] as const;

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
    const dates = await this.prisma.tradeCampaign.findMany({ where: ownerScope, select: { tradingDate: true }, distinct: ['tradingDate'], orderBy: { tradingDate: 'asc' } });
    const actualDates = dates.map(({ tradingDate }) => this.seoulDate(tradingDate));
    const selectedDate = date ?? actualDates.at(-1);
    const index = selectedDate ? actualDates.indexOf(selectedDate) : -1;
    const campaigns = index >= 0 ? await this.prisma.tradeCampaign.findMany({
      where: { ...ownerScope, tradingDate: new Date(`${selectedDate}T00:00:00.000Z`) },
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
      campaigns: campaigns.map((campaign) => this.serializeCampaign({
        ...campaign,
        conflicts: [
          ...campaign.conflicts,
          ...unresolvedConflicts.filter((conflict) => Array.isArray(conflict.candidateCampaignIds) && conflict.candidateCampaignIds.includes(campaign.id)),
        ],
      }, provenBalances)),
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
  async getStats(ownerId: string, accountId?: string): Promise<TradeStatsResponse> {
    const ownerScope = await this.ownerScope(ownerId, { accountId });
    const trades = (await this.prisma.trade.findMany({
      where: { ...ownerScope, status: PrismaTradeStatus.CLOSED, entry: { isNot: null }, exit: { isNot: null } },
      ...tradeWithRelations,
    })).map((trade) => this.serialize(trade));
    const points = trades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0);
    const riskAmountTrades = trades.filter((trade) => trade.riskAmount !== undefined);
    const riskPercentTrades = trades.filter((trade) => trade.riskPercent !== undefined);
    const bucket = (key: string, label: string, items: TradeRecord[]) => ({
      key,
      label,
      count: items.length,
      realizedPnl: items.reduce((sum, item) => sum + (item.realizedPnl ?? 0), 0),
      winRate: items.length ? items.filter((item) => (item.realizedPnl ?? 0) > 0).length / items.length * 100 : 0,
    });
    const timeframeGroups = new Map<string, TradeRecord[]>();
    const sessionGroups = new Map<string, TradeRecord[]>();
    for (const trade of trades) {
      const timeframe = trade.analysis.baseTimeframe ?? 'unspecified';
      timeframeGroups.set(timeframe, [...(timeframeGroups.get(timeframe) ?? []), trade]);
      const session = this.tradingSession(new Date(trade.openedAt ?? trade.entry!.occurredAt));
      sessionGroups.set(session, [...(sessionGroups.get(session) ?? []), trade]);
    }
    return {
      overview: {
        totalTrades: trades.length,
        totalRealizedPnl: points,
        averageRealizedPnl: trades.length ? points / trades.length : 0,
        winRate: trades.length ? trades.filter((trade) => (trade.realizedPnl ?? 0) > 0).length / trades.length * 100 : 0,
        totalRiskAmount: riskAmountTrades.reduce((sum, trade) => sum + trade.riskAmount!, 0),
        riskAmountCount: riskAmountTrades.length,
        averageRiskPercent: riskPercentTrades.length ? riskPercentTrades.reduce((sum, trade) => sum + trade.riskPercent!, 0) / riskPercentTrades.length : 0,
        riskPercentCount: riskPercentTrades.length,
      },
      bySession: [...sessionGroups.entries()].map(([key, items]) => bucket(key, key, items)),
      byBaseTimeframe: [...timeframeGroups.entries()].map(([key, items]) => bucket(key, key, items)),
    };
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
  private tradingSession(occurredAt: Date): 'asia' | 'london' | 'new-york' | 'off-session' {
    const localHour = (timeZone: string): number => {
      const hour = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(occurredAt).find((part) => part.type === 'hour')?.value;
      return Number(hour);
    };
    const newYorkHour = localHour('America/New_York');
    if (newYorkHour >= 8 && newYorkHour < 17) return 'new-york';
    const londonHour = localHour('Europe/London');
    if (londonHour >= 8 && londonHour < 17) return 'london';
    const tokyoHour = localHour('Asia/Tokyo');
    if (tokyoHour >= 9 && tokyoHour < 16) return 'asia';
    return 'off-session';
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
    await tx.tradeCampaign.update({ where: { id: campaignId }, data: { rootTradeId: root.tradeId, tradingDate: this.seoulMidnight(root.trade.openedAt!) } });
  }

  private async relinkCampaignInTransaction(tx: Tx, tradeId: string, campaignId: string, prepareSource = true): Promise<void> {
    const campaign = await tx.tradeCampaign.findUnique({ where: { id: campaignId }, include: { rootTrade: true } });
    if (!campaign) throw new NotFoundException(`Campaign ${campaignId} not found`);
    const trade = await this.findTrade(tx, campaign.ownerId, campaign.mt5AccountId ?? undefined, tradeId);
    if (campaign.ownerId !== trade.ownerId || campaign.mt5AccountId !== trade.mt5AccountId || campaign.rootTrade.symbol !== trade.symbol || campaign.rootTrade.side !== trade.side) throw new BadRequestException('Campaign is incompatible with trade owner, account, symbol, or side');
    const previous = await tx.campaignMembership.findUnique({ where: { tradeId } });
    if (prepareSource && previous && previous.campaignId !== campaignId) await this.prepareCampaignForMemberMove(tx, previous.campaignId, tradeId);
    await tx.campaignMembership.upsert({ where: { tradeId }, create: { tradeId, campaignId, source: 'MANUAL' }, update: { campaignId, source: 'MANUAL' } });
    await this.normalizeCampaign(tx, campaignId);
  }

  private async normalizeCampaign(tx: Tx, campaignId: string): Promise<void> {
    const members = await tx.campaignMembership.findMany({
      where: { campaignId },
      include: { trade: { select: { id: true, openedAt: true, mt5PositionId: true } } },
      orderBy: [{ trade: { openedAt: 'asc' } }, { trade: { mt5PositionId: 'asc' } }, { tradeId: 'asc' }],
    });
    if (!members.length) {
      await tx.tradeCampaign.delete({ where: { id: campaignId } });
      await this.pruneCampaignConflictCandidates(tx, campaignId);
      return;
    }
    const root = members.find((member) => member.trade.openedAt);
    if (!root) return;
    await tx.tradeCampaign.update({ where: { id: campaignId }, data: { rootTradeId: root.tradeId, tradingDate: this.seoulMidnight(root.trade.openedAt!) } });
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
  private serializeCampaign(campaign: CampaignWithRelations, provenBalances = new Map<string, Prisma.Decimal>()): TradeCampaign {
    if (!campaign.analysis) throw new Error(`Campaign ${campaign.id} lacks analysis`);
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
      tradingDate: this.seoulDate(campaign.tradingDate),
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
    };
  }
  private executionAnalysisComplete(analysis: TradeWithRelations['analysis']): boolean {
    if (!analysis?.baseTimeframe) return false;
    if (!analysis.bollingerBandCount && analysis.bollingerDirection) return false;
    if (analysis.bollingerBandCount && !analysis.bollingerDirection) return false;
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
      strategy: optional(trade.strategy), thesis: optional(trade.thesis),
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
      createdAt: trade.createdAt.toISOString(), updatedAt: trade.updatedAt.toISOString(),
    };
  }
}
