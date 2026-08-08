import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  HealthResponse,
  PatchTradeAnalysisRequest,
  RelinkTradeCampaignRequest,
  ResolveCampaignConflictRequest,
  TradeCampaign,
  TradeCampaignDateResponse,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeRecord,
  TradeStatsResponse,
  UpdateTradeExecutionNoteRequest,
  UpdateTradeRequest,
} from '@trading-journal/shared';
import {
  Prisma,
  TradeAnalysisBollingerBandCount as PrismaBollingerBandCount,
  TradeAnalysisBollingerDirection as PrismaBollingerDirection,
  TradeAnalysisChartPatternType as PrismaChartPatternType,
  TradeAnalysisCross as PrismaCross,
  TradeAnalysisEconomicIndicatorImpact as PrismaIndicatorImpact,
  TradeAnalysisMaArrangement as PrismaMaArrangement,
  TradeAnalysisPrimaryTrend as PrismaPrimaryTrend,
  TradeSide as PrismaTradeSide,
  TradeStatus as PrismaTradeStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateTradeAnalysisPatchRequest, validateUpdateTradeRequest } from './trade-log.validation';

export interface TradeScopeInput {
  scope?: 'all' | 'manual' | 'account';
  accountId?: string;
}

const tradeWithRelations = Prisma.validator<Prisma.TradeDefaultArgs>()({ include: { entry: true, exit: true, analysis: { include: { economicIndicators: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } } } } });
type TradeWithRelations = Prisma.TradeGetPayload<typeof tradeWithRelations>;
const campaignWithRelations = Prisma.validator<Prisma.TradeCampaignDefaultArgs>()({
  include: {
    rootTrade: { include: tradeWithRelations.include },
    memberships: { include: { trade: { include: tradeWithRelations.include } }, orderBy: { createdAt: 'asc' } },
    conflicts: { orderBy: { createdAt: 'asc' } },
    images: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
  },
});
type CampaignWithRelations = Prisma.TradeCampaignGetPayload<typeof campaignWithRelations>;
type Tx = Prisma.TransactionClient;
const analysisFields = ['baseTimeframe','primaryTrend','bollingerBandCount','bollingerDirection','maArrangement','cross','stopLossLine','marketZoneEnabled','marketZoneHigh','marketZoneLow','chartPatternObserved','chartPatternTimeframe','chartPatternType','retailPositionEnabled','retailBuyAveragePrice','retailSellAveragePrice','retailBuyRatio','fibonacciEnabled','fibonacciStartPrice','fibonacciEndPrice','regret'] as const;

@Injectable()
export class TradeLogService {
  constructor(private readonly prisma: PrismaService) {}
  health(): HealthResponse { return { status: 'ok', service: 'sentra-trade-log', timestamp: new Date().toISOString() }; }

  async getTrade(ownerId: string, id: string): Promise<TradeRecord> { return this.serialize(await this.findTrade(this.prisma, ownerId, id)); }
  async updateTrade(ownerId: string, id: string, request: UpdateTradeRequest): Promise<TradeRecord> {
    validateUpdateTradeRequest(request);
    const allowed = new Set(['strategy', 'thesis', 'entryRationale', 'exitRationale', 'takeProfitCriteria', 'stopLossCriteria', 'note']);
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some((key) => !allowed.has(key))) throw new BadRequestException('Only qualitative trade fields may be updated');
    await this.findTrade(this.prisma, ownerId, id);
    const trade = await this.prisma.trade.update({
      where: { id },
      data: {
        strategy: request.strategy,
        thesis: request.thesis,
        entryRationale: request.entryRationale,
        exitRationale: request.exitRationale,
        takeProfitCriteria: request.takeProfitCriteria,
        stopLossCriteria: request.stopLossCriteria,
        note: request.note,
      },
      include: tradeWithRelations.include,
    });
    return this.serialize(trade);
  }

  async updateTradeEntryNote(ownerId: string, id: string, request: UpdateTradeExecutionNoteRequest): Promise<TradeRecord> {
    if (!request || typeof request !== 'object' || Array.isArray(request) || !Object.hasOwn(request, 'note') || Object.keys(request).some((key) => key !== 'note')) throw new BadRequestException('note is required');
    await this.findTrade(this.prisma, ownerId, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.tradeEntry.update({ where: { tradeId: id }, data: { note: request.note ?? null } });
      return this.serialize(await this.findTrade(tx, ownerId, id));
    });
  }

  async updateTradeExitNote(ownerId: string, id: string, request: UpdateTradeExecutionNoteRequest): Promise<TradeRecord> {
    if (!request || typeof request !== 'object' || Array.isArray(request) || !Object.hasOwn(request, 'note') || Object.keys(request).some((key) => key !== 'note')) throw new BadRequestException('note is required');
    await this.findTrade(this.prisma, ownerId, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.tradeExit.update({ where: { tradeId: id }, data: { note: request.note ?? null } });
      return this.serialize(await this.findTrade(tx, ownerId, id));
    });
  }

  async patchTradeAnalysis(ownerId: string, id: string, request: PatchTradeAnalysisRequest): Promise<TradeRecord> {
    validateTradeAnalysisPatchRequest(request);
    await this.findTrade(this.prisma, ownerId, id);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; updated_at: Date }>>(Prisma.sql`SELECT id, updated_at FROM "trade_analyses" WHERE trade_id = ${id} FOR UPDATE`);
      if (!rows.length) throw new NotFoundException(`Trade ${id} not found`);
      if (rows[0].updated_at.getTime() !== new Date(request.expectedUpdatedAt).getTime()) throw new ConflictException('Trade analysis was updated by another request');
      const current = await tx.tradeAnalysis.findUniqueOrThrow({ where: { id: rows[0].id }, include: { economicIndicators: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } } });
      const data: Record<string, unknown> = {};
      for (const field of analysisFields) {
        if (request[field] !== undefined) data[field] = request[field];
      }
      if (request.primaryTrend !== undefined) data.primaryTrend = request.primaryTrend === null ? null : PrismaPrimaryTrend[request.primaryTrend.toUpperCase() as keyof typeof PrismaPrimaryTrend];
      if (request.bollingerBandCount !== undefined) data.bollingerBandCount = request.bollingerBandCount === null ? null : PrismaBollingerBandCount[request.bollingerBandCount.toUpperCase() as keyof typeof PrismaBollingerBandCount];
      if (request.bollingerDirection !== undefined) data.bollingerDirection = request.bollingerDirection === null ? null : PrismaBollingerDirection[request.bollingerDirection.toUpperCase() as keyof typeof PrismaBollingerDirection];
      if (request.maArrangement !== undefined) data.maArrangement = request.maArrangement === null ? null : PrismaMaArrangement[request.maArrangement.toUpperCase() as keyof typeof PrismaMaArrangement];
      if (request.cross !== undefined) data.cross = request.cross === null ? null : PrismaCross[request.cross.toUpperCase() as keyof typeof PrismaCross];
      if (request.chartPatternType !== undefined) data.chartPatternType = request.chartPatternType === null ? null : PrismaChartPatternType[request.chartPatternType.toUpperCase() as keyof typeof PrismaChartPatternType];
      this.canonicalizeDisabledGroups(request, data);
      this.canonicalizeAndValidate({ ...current, ...data });
      if (request.economicIndicators !== undefined) {
        const currentIds = new Set(current.economicIndicators.map((indicator) => indicator.id));
        const suppliedIds = request.economicIndicators.flatMap((indicator) => indicator.id ? [indicator.id] : []);
        const unknownIds = suppliedIds.filter((indicatorId) => !currentIds.has(indicatorId));
        if (unknownIds.length) throw new BadRequestException('Economic indicator id does not belong to this analysis');
        await tx.tradeAnalysisEconomicIndicator.deleteMany({
          where: { analysisId: current.id, id: { in: [...currentIds].filter((indicatorId) => !suppliedIds.includes(indicatorId)) } },
        });
        await tx.$executeRaw`UPDATE "trade_analysis_economic_indicators" SET "position" = -"position" - 1 WHERE "analysis_id" = ${current.id}`;
        for (const [position, indicator] of request.economicIndicators.entries()) {
          const indicatorData = {
            type: indicator.type.trim(),
            impact: indicator.impact === 'positive' ? PrismaIndicatorImpact.POSITIVE : PrismaIndicatorImpact.NEGATIVE,
            position,
          };
          if (indicator.id) {
            await tx.tradeAnalysisEconomicIndicator.update({ where: { id: indicator.id }, data: indicatorData });
          } else {
            await tx.tradeAnalysisEconomicIndicator.create({ data: { analysisId: current.id, ...indicatorData } });
          }
        }
      }
      await tx.tradeAnalysis.update({
        where: { id: current.id },
        data,
      });
      return this.serialize(await this.findTrade(tx, ownerId, id));
    });
  }

  async listCampaigns(ownerId: string, date?: string, scope: TradeScopeInput = {}): Promise<TradeCampaignDateResponse> {
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const ownerScope = await this.ownerScope(ownerId, scope);
    const dates = await this.prisma.tradeCampaign.findMany({ where: ownerScope, select: { tradingDate: true }, distinct: ['tradingDate'], orderBy: { tradingDate: 'asc' } });
    const actualDates = dates.map(({ tradingDate }) => this.seoulDate(tradingDate));
    const selectedDate = date ?? actualDates.at(-1);
    const index = selectedDate ? actualDates.indexOf(selectedDate) : -1;
    const campaigns = index >= 0 ? await this.prisma.tradeCampaign.findMany({
      where: { ...ownerScope, tradingDate: new Date(`${selectedDate}T00:00:00.000Z`) },
      include: campaignWithRelations.include,
      orderBy: { rootTrade: { openedAt: 'asc' } },
    }) : [];
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
      })),
      diagnostics: { missingOpenedAtTradeIds },
    };
  }

  async relinkCampaign(ownerId: string, request: RelinkTradeCampaignRequest): Promise<void> {
    if (!request || typeof request.tradeId !== 'string' || !request.tradeId) throw new BadRequestException('tradeId is required');
    const initial = await this.findTrade(this.prisma, ownerId, request.tradeId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, initial.mt5Server, initial.mt5AccountLogin);
      const trade = await this.findTrade(tx, ownerId, request.tradeId);
      if (!trade.openedAt) throw new BadRequestException('Trade without openedAt cannot be linked');
      const previous = await tx.campaignMembership.findUnique({ where: { tradeId: trade.id } });
      if (previous && previous.campaignId !== request.campaignId) await this.prepareCampaignForMemberMove(tx, previous.campaignId, trade.id);
      const campaignId = request.campaignId ?? (await tx.tradeCampaign.create({
        data: { rootTradeId: trade.id, tradingDate: this.seoulMidnight(trade.openedAt), ownerId, mt5AccountId: trade.mt5AccountId },
      })).id;
      const target = await tx.tradeCampaign.findFirst({ where: { id: campaignId, ownerId } });
      if (!target || target.mt5AccountId !== trade.mt5AccountId) throw new BadRequestException('Campaign and trade account scope must match');
      await this.relinkCampaignInTransaction(tx, trade.id, campaignId, false);
      await this.normalizeCampaign(tx, campaignId);
    });
  }

  async resolveCampaignConflict(ownerId: string, id: string, request: ResolveCampaignConflictRequest): Promise<void> {
    if (!request || typeof request.campaignId !== 'string' || !request.campaignId) throw new BadRequestException('campaignId is required');
    const initial = await this.prisma.campaignConflict.findFirst({ where: { id, trade: { ownerId } }, include: { trade: true } });
    if (!initial) throw new NotFoundException(`Unresolved campaign conflict ${id} not found`);
    await this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, initial.trade.mt5Server, initial.trade.mt5AccountLogin);
      const conflict = await tx.campaignConflict.findUnique({ where: { id } });
      if (!conflict || conflict.status !== 'UNRESOLVED') throw new NotFoundException(`Unresolved campaign conflict ${id} not found`);
      const candidates = conflict.candidateCampaignIds as string[];
      if (!Array.isArray(candidates) || !candidates.includes(request.campaignId)) throw new BadRequestException('Campaign is not a conflict candidate');
      const campaign = await tx.tradeCampaign.findFirst({ where: { id: request.campaignId, ownerId } });
      if (!campaign || campaign.mt5AccountId !== initial.trade.mt5AccountId) throw new BadRequestException('Campaign and trade account scope must match');
      await this.relinkCampaignInTransaction(tx, conflict.tradeId, request.campaignId);
      await tx.campaignConflict.update({ where: { id }, data: { status: 'RESOLVED', resolvedCampaignId: request.campaignId, resolvedAt: new Date() } });
    });
  }
  async getStats(ownerId: string, scope: TradeScopeInput = {}): Promise<TradeStatsResponse> {
    const ownerScope = await this.ownerScope(ownerId, scope);
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
      realizedPoints: items.reduce((sum, item) => sum + (item.realizedPnl ?? 0), 0),
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
        totalRealizedPoints: points,
        averageRealizedPoints: trades.length ? points / trades.length : 0,
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
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.rawText !== 'string' || !['telegram', 'manual', 'api'].includes(request.source) || !Array.isArray(request.actions)) {
      throw new BadRequestException('Assistant request is invalid');
    }
    const trades: TradeRecord[] = [];
    for (const action of request.actions) {
      if (!action || action.type !== 'patch_trade_analysis' || !action.tradeId) throw new BadRequestException('Unsupported assistant action type');
      trades.push(await this.patchTradeAnalysis(ownerId, action.tradeId, action.payload));
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
  private async lockAccount(tx: Tx, server: string | null, accountLogin: bigint | null): Promise<void> {
    if (!server || accountLogin === null) throw new BadRequestException('Campaign membership requires an MT5 account');
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`${server}:${accountLogin}`}, 0))) AS account_lock`;
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
    const trade = await this.findTrade(tx, campaign.ownerId, tradeId);
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
    const conflicts = await tx.campaignConflict.findMany({ where: { status: 'UNRESOLVED' } });
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
  private async ownerScope(ownerId: string, input: TradeScopeInput): Promise<{ ownerId: string; mt5AccountId?: string | null }> {
    const scope = input.scope ?? 'all';
    if (!['all', 'manual', 'account'].includes(scope)) throw new BadRequestException('scope must be all, manual, or account');
    if (scope !== 'account' && input.accountId !== undefined) throw new BadRequestException('accountId is only valid for account scope');
    if (scope === 'account') {
      if (!input.accountId) throw new BadRequestException('accountId is required for account scope');
      const account = await this.prisma.mt5Account.findFirst({ where: { id: input.accountId, ownerId }, select: { id: true } });
      if (!account) throw new ForbiddenException('Account scope is unavailable');
      return { ownerId, mt5AccountId: account.id };
    }
    return scope === 'manual' ? { ownerId, mt5AccountId: null } : { ownerId };
  }

  private async findTrade(client: PrismaService | Tx, ownerId: string, id: string): Promise<TradeWithRelations> {
    const trade = await client.trade.findFirst({ where: { id, ownerId }, ...tradeWithRelations });
    if (!trade) throw new NotFoundException(`Trade ${id} not found`);
    return trade;
  }
  private canonicalizeDisabledGroups(request: PatchTradeAnalysisRequest, data: Record<string, unknown>): void {
    const groups: Array<[keyof PatchTradeAnalysisRequest, Array<keyof PatchTradeAnalysisRequest>]> = [
      ['marketZoneEnabled', ['marketZoneHigh', 'marketZoneLow']],
      ['chartPatternObserved', ['chartPatternTimeframe', 'chartPatternType']],
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
    group('chartPatternObserved', ['chartPatternTimeframe', 'chartPatternType']);
    group('retailPositionEnabled', ['retailBuyAveragePrice', 'retailSellAveragePrice', 'retailBuyRatio']);
    group('fibonacciEnabled', ['fibonacciStartPrice', 'fibonacciEndPrice']);
    if (analysis.marketZoneEnabled && Number(analysis.marketZoneHigh) <= Number(analysis.marketZoneLow)) throw new BadRequestException('marketZoneHigh must exceed marketZoneLow');
    if (analysis.fibonacciEnabled && Number(analysis.fibonacciStartPrice) === Number(analysis.fibonacciEndPrice)) throw new BadRequestException('fibonacci endpoints must differ');
  }
  private serializeCampaign(campaign: CampaignWithRelations): TradeCampaign {
    const root = this.serialize(campaign.rootTrade);
    const members = campaign.memberships.map((membership) => this.serialize(membership.trade));
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
    const completeRiskAmounts = members.every((trade) =>
      trade.riskAmount != null && Boolean(trade.accountCurrency),
    );
    const sameRiskCurrency = completeRiskAmounts && members.every((trade) =>
      trade.accountCurrency === members[0].accountCurrency,
    );
    const riskAmount = sameRiskCurrency
      ? members.reduce((sum, trade) => sum + trade.riskAmount!, 0)
      : undefined;
    const completeRiskPercents = members.every((trade) =>
      trade.riskPercent != null && Boolean(trade.accountCurrency) && trade.seedBalance != null,
    );
    const sameAccountAndSeed = completeRiskPercents && members.every((trade) =>
      trade.accountCurrency === members[0].accountCurrency && trade.seedBalance === members[0].seedBalance,
    );
    const riskPercent = sameAccountAndSeed
      ? members.reduce((sum, trade) => sum + trade.riskPercent!, 0)
      : undefined;
    const latestClosedWithReason = members
      .filter((trade) => trade.closedAt !== undefined && trade.exitReason !== undefined)
      .sort((left, right) => new Date(right.closedAt!).getTime() - new Date(left.closedAt!).getTime())[0];
    return {
      id: campaign.id,
      rootTradeId: campaign.rootTradeId,
      tradingDate: this.seoulDate(campaign.tradingDate),
      symbol: root.symbol,
      side: root.side,
      status: open ? 'open' : 'closed',
      entryPrice: weighted(members, 'entryPrice', (trade) => trade.quantityLots ?? 0),
      exitPrice: weighted(members, 'exitPrice', (trade) => trade.exit?.quantity ?? 0),
      quantityLots: quantity,
      remainingQuantityLots: quantity - exited,
      exitReason: latestClosedWithReason?.exitReason,
      realizedPnl: members.reduce((sum: number, trade: TradeRecord) => sum + (trade.realizedPnl ?? 0), 0),
      openedAt: root.openedAt!,
      closedAt: closedAt?.toISOString(),
      takeProfitPrice: root.takeProfitPrice,
      stopLossPrice: root.stopLossPrice,
      seedBalance: root.seedBalance,
      riskAmount,
      riskPercent,
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
      regret: root.analysis.regret,
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
  private serialize(trade: TradeWithRelations): TradeRecord {
    const analysis = trade.analysis;
    if (!analysis) throw new Error(`Trade ${trade.id} lacks analysis`);
    const optional = <T>(value: T | null): T | undefined => value ?? undefined;
    const decimal = (value: Prisma.Decimal | null): number | undefined => value === null ? undefined : Number(value);
    return {
      id: trade.id, symbol: trade.symbol, side: trade.side.toLowerCase() as 'long' | 'short',
      status: trade.status.toLowerCase() as TradeRecord['status'],
      strategy: optional(trade.strategy), thesis: optional(trade.thesis),
      entryRationale: optional(trade.entryRationale), exitRationale: optional(trade.exitRationale),
      takeProfitCriteria: optional(trade.takeProfitCriteria), stopLossCriteria: optional(trade.stopLossCriteria),
      note: optional(trade.note),
      accountCurrency: optional(trade.accountCurrency), quantityLots: decimal(trade.quantityLots),
      entryPrice: decimal(trade.entryPrice), exitPrice: decimal(trade.exitPrice),
      exitReason: optional(trade.exitReason) as TradeRecord['exitReason'], realizedPnl: decimal(trade.realizedPnl),
      takeProfitPrice: decimal(trade.takeProfitPrice), stopLossPrice: decimal(trade.stopLossPrice),
      seedBalance: decimal(trade.seedBalance), riskAmount: decimal(trade.riskAmount), riskPercent: decimal(trade.riskPercent),
      openedAt: trade.openedAt?.toISOString(), closedAt: trade.closedAt?.toISOString(),
      entry: trade.entry ? { price: Number(trade.entry.price), quantity: decimal(trade.entry.quantity), occurredAt: trade.entry.occurredAt.toISOString(), note: optional(trade.entry.note) } : undefined,
      exit: trade.exit ? { price: Number(trade.exit.price), quantity: decimal(trade.exit.quantity), occurredAt: trade.exit.occurredAt.toISOString(), reason: optional(trade.exit.reason) as TradeRecord['exitReason'], note: optional(trade.exit.note) } : undefined,
      analysis: {
        schemaVersion: 1,
        baseTimeframe: optional(analysis.baseTimeframe),
        primaryTrend: optional(analysis.primaryTrend)?.toLowerCase() as TradeRecord['analysis']['primaryTrend'],
        bollingerBandCount: optional(analysis.bollingerBandCount)?.toLowerCase() as TradeRecord['analysis']['bollingerBandCount'],
        bollingerDirection: optional(analysis.bollingerDirection)?.toLowerCase() as TradeRecord['analysis']['bollingerDirection'],
        maArrangement: optional(analysis.maArrangement)?.toLowerCase() as TradeRecord['analysis']['maArrangement'],
        cross: optional(analysis.cross)?.toLowerCase() as TradeRecord['analysis']['cross'],
        stopLossLine: decimal(analysis.stopLossLine), marketZoneEnabled: analysis.marketZoneEnabled,
        marketZoneHigh: decimal(analysis.marketZoneHigh), marketZoneLow: decimal(analysis.marketZoneLow),
        chartPatternObserved: analysis.chartPatternObserved, chartPatternTimeframe: optional(analysis.chartPatternTimeframe),
        chartPatternType: optional(analysis.chartPatternType)?.toLowerCase() as TradeRecord['analysis']['chartPatternType'],
        retailPositionEnabled: analysis.retailPositionEnabled, retailBuyAveragePrice: decimal(analysis.retailBuyAveragePrice),
        retailSellAveragePrice: decimal(analysis.retailSellAveragePrice), retailBuyRatio: decimal(analysis.retailBuyRatio),
        fibonacciEnabled: analysis.fibonacciEnabled, fibonacciStartPrice: decimal(analysis.fibonacciStartPrice),
        fibonacciEndPrice: decimal(analysis.fibonacciEndPrice), regret: optional(analysis.regret),
        economicIndicators: analysis.economicIndicators.map((indicator) => ({ id: indicator.id, type: indicator.type, impact: indicator.impact.toLowerCase() as 'positive' | 'negative', position: indicator.position })),
        createdAt: analysis.createdAt.toISOString(), updatedAt: analysis.updatedAt.toISOString(),
      },
      createdAt: trade.createdAt.toISOString(), updatedAt: trade.updatedAt.toISOString(),
    };
  }
}
