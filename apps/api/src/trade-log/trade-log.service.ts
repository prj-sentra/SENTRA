import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  CreateTradeRequest,
  CreateTradeTagRequest,
  HealthResponse,
  TradeChecklistRates,
  TradeEntryRequest,
  TradeExitRequest,
  TradeJournalContext,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantAction,
  TradeLogAssistantActionsResponse,
  TradeLogMt5SyncResponse,
  TradeRecord,
  TradeStatsBucket,
  TradeStatsResponse,
  TradeTagCatalog,
  TradeTagCount,
  TradeTagDefinition,
  TradeTagField,
  TradeTimeframeTag,
  UpdateTradeEntryRequest,
  UpdateTradeExitRequest,
  UpdateTradeJournalRequest,
  UpdateTradeRequest,
} from '@trading-journal/shared';
import { Prisma, TradeSide as PrismaTradeSide, TradeStatus as PrismaTradeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  validateCreateTradeRequest,
  validateCreateTradeTagRequest,
  validateTradeEntryRequest,
  validateTradeExitRequest,
  validateTradeJournalPatchRequest,
  validateTradeLogAssistantActionsRequest,
  validateUpdateTradeEntryRequest,
  validateUpdateTradeExitRequest,
  validateUpdateTradeRequest,
} from './trade-log.validation';

const tradeWithRelations = Prisma.validator<Prisma.TradeDefaultArgs>()({
  include: {
    entry: true,
    exit: true,
    resultLabelTag: true,
    setupTagLinks: { include: { tag: true } },
    ruleViolationTagLinks: { include: { tag: true } },
    lessonTagLinks: { include: { tag: true } },
  },
});

type TradeWithRelations = Prisma.TradeGetPayload<typeof tradeWithRelations>;
type Tx = Prisma.TransactionClient;
type TagDefinitionRow = {
  id: number;
  field: unknown;
  label: string;
  normalizedLabel: string;
  systemDefined: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const SETUP_TAG_ALIASES: Record<string, string> = {
  원볼: '원볼',
  oneball: '원볼',
  투볼: '투볼',
  twoball: '투볼',
  정볼: '정볼',
  jeongball: '정볼',
  역볼: '역볼',
  reverseball: '역볼',
  원볼정볼: '원볼 정볼',
  oneballjeongball: '원볼 정볼',
  원볼역볼: '원볼 역볼',
  oneballreverseball: '원볼 역볼',
  투볼정볼: '투볼 정볼',
  twoballjeongball: '투볼 정볼',
  투볼역볼: '투볼 역볼',
  twoballreverseball: '투볼 역볼',
  추세눌림: '추세 눌림',
  trendpullback: '추세 눌림',
  돌파: '돌파',
  breakout: '돌파',
  테스트: '테스트',
  test: '테스트',
  없음: '없음',
  none: '없음',
  nosetup: '없음',
  기타: '기타',
  other: '기타',
};

const REVIEW_TAG_ALIASES: Record<string, string> = {
  timeframeinconsistency: '기준봉/관리봉 불일치',
  targetplanninggap: '목표 계획 정합성 부족',
  targetalignmentmissing: '목표 계획 정합성 부족',
  lowertimeframeoverweight: '하위 타임프레임 과신',
  stoptootight: '손절 폭 과도하게 짧음',
  prematurestopadjustment: 'SL 조기 이동',
  prematurestopmove: 'SL 조기 이동',
  trendmisread: '추세 해석 오류',
  resistanceignored: '상위 저항 반영 부족',
  managementmodelmismatch: 'setup 대비 관리 방식 불일치',
  reentrywithoutrevalidation: '재진입 전 재검증 부족',
  decisionqualitydegradedinposition: '보유 중 판단 품질 저하',
  nocloseconfirmation: '봉마감 확인 없이 진입',
  entrybeforerequiredclose: '봉마감 확인 없이 진입',
  missingentryconfirmation: '필수 진입 확인 부재',
  noindependentsetupvalidation: '하위 setup 독립 검증 부재',
  nodependentsetupvalidation: '하위 setup 독립 검증 부재',
  invalidstoplocation: '손절 위치 부적절',
  capitalprotectionpriority: '자본 보호 우선 관리',
  usestructuralstop: '구조 기준 손절 사용',
  keepmanagementtimeframe: '진입 기준봉으로 관리 유지',
  definetargetwithconfluence: '목표를 구조 합치로 정의',
  keepentryconfirmationrequirements: '필수 진입 확인 조건 유지',
  requireentryconfirmation: '필수 진입 확인 조건 유지',
  revalidatebeforereentry: '재진입 전 추세 재검증',
  revalidatetrendbeforereentry: '재진입 전 추세 재검증',
  splitindependenttrades: '독립 trade 분리 유지',
  preserveindependenttrades: '독립 trade 분리 유지',
  isolatetesttrades: '테스트성 거래 분리 관리',
  separatetesttrades: '테스트성 거래 분리 관리',
  fastprofitoncountertrend: '역추세는 빠른 익절 우선',
  avoidresultbasedjustification: '결과로 나쁜 프로세스 정당화 금지',
  requirehighertimeframeconfluence: '상위 타임프레임 합치 확인',
  defineinvalidationclearly: '무효화 기준 명확화',
  otherreviewissue: '기타 리뷰 이슈',
  otherreviewlesson: '기타 리뷰 교훈',
};

const DEFAULT_RESULT_LABELS = new Set(['익절', '손절', '본절 청산', '부분 익절', '부분 손절', '취소']);
const execAsync = promisify(execCallback);

@Injectable()
export class TradeLogService {
  constructor(private readonly prisma: PrismaService) {}

  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'sentra-trade-log',
      timestamp: new Date().toISOString(),
    };
  }

  async listTags(): Promise<TradeTagCatalog> {
    const [setup, ruleViolation, lesson, resultLabel] = await Promise.all([
      this.prisma.setupTagDefinition.findMany({ orderBy: [{ label: 'asc' }] }),
      this.prisma.ruleViolationTagDefinition.findMany({ orderBy: [{ label: 'asc' }] }),
      this.prisma.lessonTagDefinition.findMany({ orderBy: [{ label: 'asc' }] }),
      this.prisma.resultLabelTagDefinition.findMany({ orderBy: [{ label: 'asc' }] }),
    ]);

    return {
      setup: setup.map((row) => this.toTagDefinition(row)),
      ruleViolation: ruleViolation.map((row) => this.toTagDefinition(row)),
      lesson: lesson.map((row) => this.toTagDefinition(row)),
      resultLabel: resultLabel.map((row) => this.toTagDefinition(row)),
    };
  }

  async listTagsByField(field: TradeTagField): Promise<TradeTagDefinition[]> {
    switch (field) {
      case 'setup':
        return (await this.prisma.setupTagDefinition.findMany({ orderBy: [{ label: 'asc' }] })).map((row) =>
          this.toTagDefinition(row),
        );
      case 'rule-violation':
        return (await this.prisma.ruleViolationTagDefinition.findMany({ orderBy: [{ label: 'asc' }] })).map((row) =>
          this.toTagDefinition(row),
        );
      case 'lesson':
        return (await this.prisma.lessonTagDefinition.findMany({ orderBy: [{ label: 'asc' }] })).map((row) =>
          this.toTagDefinition(row),
        );
      case 'result-label':
        return (await this.prisma.resultLabelTagDefinition.findMany({ orderBy: [{ label: 'asc' }] })).map((row) =>
          this.toTagDefinition(row),
        );
      default:
        throw new BadRequestException(`Unsupported tag field: ${field}`);
    }
  }

  async createTag(request: CreateTradeTagRequest): Promise<TradeTagDefinition> {
    validateCreateTradeTagRequest(request);

    return this.prisma.$transaction(async (tx) => {
      const [definition] = await this.ensureTagDefinitions(tx, request.field, [request.label]);
      return definition;
    });
  }

  async createTrade(request: CreateTradeRequest): Promise<TradeRecord> {
    validateCreateTradeRequest(request);

    return this.prisma.$transaction(async (tx) => {
      const normalizedJournal = this.normalizeTradeJournal(request.journal, {
        timeframe: request.timeframe,
        thesis: request.thesis,
        note: request.note,
      });
      const tagRefs = await this.resolveTradeTagRefs(tx, normalizedJournal, {
        thesis: request.thesis,
        note: request.note,
      });

      const trade = await tx.trade.create({
        data: {
          symbol: request.symbol.trim(),
          side: this.toPrismaTradeSide(request.side),
          status: PrismaTradeStatus.PLANNED,
          timeframe: request.timeframe,
          session: request.session,
          strategy: request.strategy,
          thesis: request.thesis,
          note: request.note,
          journal: this.toPrismaJson(this.stripStoredTradeJournal(normalizedJournal)),
          resultLabelTagId: tagRefs.resultLabel?.id,
          setupTagLinks: this.toSetupTagLinkCreate(tagRefs.setupTags),
          ruleViolationTagLinks: this.toRuleViolationTagLinkCreate(tagRefs.ruleViolationTags),
          lessonTagLinks: this.toLessonTagLinkCreate(tagRefs.lessonTags),
        },
        ...tradeWithRelations,
      });

      return this.toTradeRecord(trade);
    });
  }

  async listTrades(): Promise<TradeRecord[]> {
    const trades = await this.prisma.trade.findMany({
      ...tradeWithRelations,
      orderBy: { createdAt: 'asc' },
    });
    return trades.map((trade) => this.toTradeRecord(trade));
  }

  async getStats(): Promise<TradeStatsResponse> {
    const closedTradeRows = await this.prisma.trade.findMany({
      where: {
        status: PrismaTradeStatus.CLOSED,
        entry: { isNot: null },
        exit: { isNot: null },
      },
      orderBy: { createdAt: 'asc' },
      ...tradeWithRelations,
    });
    const closedTrades = closedTradeRows.map((trade) => this.toTradeRecord(trade));

    const winningClosedTrades = closedTrades.filter((trade) => this.calculateRealizedPoints(trade) > 0).length;
    const totalRealizedPoints = closedTrades.reduce((sum, trade) => sum + this.calculateRealizedPoints(trade), 0);

    return {
      overview: {
        totalTrades: closedTrades.length,
        totalRealizedPoints: this.roundStat(totalRealizedPoints),
        averageRealizedPoints: this.roundStat(closedTrades.length > 0 ? totalRealizedPoints / closedTrades.length : 0),
        winRate: this.toRate(winningClosedTrades, closedTrades.length),
        goodCount: closedTrades.filter((trade) => trade.journal?.review?.processVerdict === 'good').length,
        observeCount: closedTrades.filter((trade) => trade.journal?.review?.processVerdict === 'observe').length,
        badCount: closedTrades.filter((trade) => trade.journal?.review?.processVerdict === 'bad').length,
        repeatBanCount: closedTrades.filter((trade) => trade.journal?.review?.processVerdict === 'repeat-ban').length,
      },
      checklistRates: this.buildChecklistRates(closedTrades),
      topRuleViolations: this.collectTopTags(closedTrades, (trade) => trade.journal?.review?.ruleViolationTags),
      topLessons: this.collectTopTags(closedTrades, (trade) => trade.journal?.review?.lessonTags),
      topResultLabels: this.collectTopTags(closedTrades, (trade) => {
        const label = trade.journal?.review?.resultLabel;
        return label ? [label] : undefined;
      }),
      bySession: this.buildBreakdown(closedTrades, (trade) => [this.classifySession(trade.session)]),
      byTimeframe: this.buildBreakdown(closedTrades, (trade) => [this.classifyTimeframe(trade)]),
      bySetupType: this.buildBreakdown(closedTrades, (trade) => this.classifySetupTags(trade)),
    };
  }

  async getTrade(id: string): Promise<TradeRecord> {
    const trade = await this.findTradeOrThrow(this.prisma, id);
    return this.toTradeRecord(trade);
  }

  async updateTrade(id: string, request: UpdateTradeRequest): Promise<TradeRecord> {
    validateUpdateTradeRequest(request);

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.findTradeOrThrow(tx, id);
      let journalUpdateData = {};

      if (request.journal !== undefined) {
        const nextTimeframe = request.timeframe !== undefined ? request.timeframe : existing.timeframe ?? undefined;
        const nextThesis = request.thesis !== undefined ? request.thesis : existing.thesis ?? undefined;
        const nextNote = request.note !== undefined ? request.note : existing.note ?? undefined;
        const normalizedJournal = this.normalizeTradeJournal(request.journal, {
          timeframe: nextTimeframe,
          thesis: nextThesis,
          note: nextNote,
        });
        const tagRefs = await this.resolveTradeTagRefs(tx, normalizedJournal, {
          thesis: nextThesis,
          note: nextNote,
        });

        journalUpdateData = {
          journal: this.toPrismaJson(this.stripStoredTradeJournal(normalizedJournal)),
          resultLabelTagId: tagRefs.resultLabel?.id ?? null,
          setupTagLinks: this.toSetupTagLinkReplace(tagRefs.setupTags),
          ruleViolationTagLinks: this.toRuleViolationTagLinkReplace(tagRefs.ruleViolationTags),
          lessonTagLinks: this.toLessonTagLinkReplace(tagRefs.lessonTags),
        };
      }

      const updated = await tx.trade.update({
        where: { id },
        data: {
          symbol: request.symbol?.trim() ?? existing.symbol,
          side: request.side ? this.toPrismaTradeSide(request.side) : existing.side,
          timeframe: request.timeframe !== undefined ? request.timeframe : existing.timeframe,
          session: request.session !== undefined ? request.session : existing.session,
          strategy: request.strategy !== undefined ? request.strategy : existing.strategy,
          thesis: request.thesis !== undefined ? request.thesis : existing.thesis,
          note: request.note !== undefined ? request.note : existing.note,
          ...journalUpdateData,
        },
        ...tradeWithRelations,
      });

      return this.toTradeRecord(updated);
    });
  }

  async patchTradeJournal(id: string, request: UpdateTradeJournalRequest): Promise<TradeRecord> {
    validateTradeJournalPatchRequest(request);

    return this.prisma.$transaction(async (tx) => {
      const trade = await this.findTradeOrThrow(tx, id);
      const current = this.toTradeRecord(trade);
      const mergedJournal = this.normalizeTradeJournal(this.mergeTradeJournal(current.journal, request), {
        timeframe: current.timeframe,
        thesis: current.thesis,
        note: current.note,
      });
      const tagRefs = await this.resolveTradeTagRefs(tx, mergedJournal, {
        thesis: current.thesis,
        note: current.note,
      });

      const updated = await tx.trade.update({
        where: { id },
        data: {
          journal: this.toPrismaJson(this.stripStoredTradeJournal(mergedJournal)),
          resultLabelTagId: tagRefs.resultLabel?.id ?? null,
          setupTagLinks: this.toSetupTagLinkReplace(tagRefs.setupTags),
          ruleViolationTagLinks: this.toRuleViolationTagLinkReplace(tagRefs.ruleViolationTags),
          lessonTagLinks: this.toLessonTagLinkReplace(tagRefs.lessonTags),
        },
        ...tradeWithRelations,
      });

      return this.toTradeRecord(updated);
    });
  }

  async recordEntry(id: string, request: TradeEntryRequest): Promise<TradeRecord> {
    validateTradeEntryRequest(request);

    const trade = await this.getTrade(id);
    if (trade.entry) {
      throw new BadRequestException('Trade already has an entry');
    }
    if (trade.status === 'closed') {
      throw new BadRequestException('Cannot enter a closed trade');
    }

    const occurredAt = new Date(request.occurredAt);
    const detectedSession = this.detectSessionFromOccurredAt(occurredAt);

    const updated = await this.prisma.trade.update({
      where: { id },
      data: {
        status: PrismaTradeStatus.OPEN,
        session: detectedSession,
        entry: {
          create: {
            price: request.price,
            quantity: request.quantity,
            occurredAt,
            note: request.note,
          },
        },
      },
      ...tradeWithRelations,
    });

    return this.toTradeRecord(updated);
  }

  async updateTradeEntry(id: string, request: UpdateTradeEntryRequest): Promise<TradeRecord> {
    validateUpdateTradeEntryRequest(request);

    const existing = await this.prisma.tradeEntry.findUnique({ where: { tradeId: id } });
    if (!existing) {
      throw new NotFoundException(`Trade entry not found: ${id}`);
    }

    await this.prisma.tradeEntry.update({
      where: { tradeId: id },
      data: {
        price: request.price ?? existing.price,
        quantity: request.quantity !== undefined ? request.quantity : existing.quantity,
        occurredAt: request.occurredAt ? new Date(request.occurredAt) : existing.occurredAt,
        note: request.note !== undefined ? request.note : existing.note,
      },
    });

    const trade = await this.prisma.trade.findUnique({ where: { id }, select: { entry: { select: { occurredAt: true } } } });
    if (trade?.entry) {
      await this.prisma.trade.update({
        where: { id },
        data: { session: this.detectSessionFromOccurredAt(trade.entry.occurredAt) },
      });
    }

    return this.getTrade(id);
  }

  async recordExit(id: string, request: TradeExitRequest): Promise<TradeRecord> {
    validateTradeExitRequest(request);

    const trade = await this.getTrade(id);
    if (!trade.entry) {
      throw new BadRequestException('Cannot exit before entry');
    }
    if (trade.exit) {
      throw new BadRequestException('Trade already has an exit');
    }

    const updated = await this.prisma.trade.update({
      where: { id },
      data: {
        status: PrismaTradeStatus.CLOSED,
        exit: {
          create: {
            price: request.price,
            quantity: request.quantity,
            occurredAt: new Date(request.occurredAt),
            reason: request.reason,
            note: request.note,
          },
        },
      },
      ...tradeWithRelations,
    });

    return this.toTradeRecord(updated);
  }

  async updateTradeExit(id: string, request: UpdateTradeExitRequest): Promise<TradeRecord> {
    validateUpdateTradeExitRequest(request);

    const existing = await this.prisma.tradeExit.findUnique({ where: { tradeId: id } });
    if (!existing) {
      throw new NotFoundException(`Trade exit not found: ${id}`);
    }

    await this.prisma.tradeExit.update({
      where: { tradeId: id },
      data: {
        price: request.price ?? existing.price,
        quantity: request.quantity !== undefined ? request.quantity : existing.quantity,
        occurredAt: request.occurredAt ? new Date(request.occurredAt) : existing.occurredAt,
        reason: request.reason !== undefined ? request.reason : existing.reason,
        note: request.note !== undefined ? request.note : existing.note,
      },
    });

    return this.getTrade(id);
  }

  async applyAssistantActions(
    request: TradeLogAssistantActionsRequest,
  ): Promise<TradeLogAssistantActionsResponse> {
    validateTradeLogAssistantActionsRequest(request);
    const touchedTrades: TradeRecord[] = [];
    let lastCreatedTradeId: string | undefined;

    for (const action of request.actions) {
      if (!this.isTradeLogAssistantAction(action)) {
        throw new BadRequestException('Unsupported assistant action type');
      }
      switch (action.type) {
        case 'create_trade': {
          const trade = await this.createTrade({
            ...action.payload,
            note: action.payload.note ?? request.rawText,
          });
          lastCreatedTradeId = trade.id;
          touchedTrades.push(trade);
          break;
        }
        case 'record_entry': {
          const tradeId = action.tradeRef === 'last_created' ? lastCreatedTradeId : undefined;
          if (!tradeId) {
            throw new BadRequestException('record_entry requires tradeRef last_created');
          }
          const updated = await this.recordEntry(tradeId, action.payload);
          this.upsertTouchedTrade(touchedTrades, updated);
          break;
        }
        case 'patch_trade_journal': {
          const updated = await this.patchTradeJournal(action.tradeId, action.payload);
          this.upsertTouchedTrade(touchedTrades, updated);
          break;
        }
        case 'record_exit': {
          const tradeId = action.tradeRef === 'last_created' ? lastCreatedTradeId : action.tradeId;
          if (!tradeId) {
            throw new BadRequestException('record_exit requires tradeId or tradeRef last_created');
          }
          const updated = await this.recordExit(tradeId, action.payload);
          this.upsertTouchedTrade(touchedTrades, updated);
          break;
        }
        default:
          throw new BadRequestException('Unsupported assistant action type');
      }
    }

    return {
      rawText: request.rawText,
      source: request.source,
      trades: touchedTrades,
    };
  }

  async syncMt5Trades(): Promise<TradeLogMt5SyncResponse> {
    const accountNumber = process.env.MT5_ACCOUNT_NUMBER?.trim();
    const readOnlyPassword = process.env.MT5_READ_ONLY_PASSWORD?.trim();
    const syncCommand = process.env.MT5_SYNC_COMMAND?.trim();

    if (!accountNumber) {
      throw new BadRequestException('MT5_ACCOUNT_NUMBER env is required');
    }
    if (!readOnlyPassword) {
      throw new BadRequestException('MT5_READ_ONLY_PASSWORD env is required');
    }
    if (!syncCommand) {
      throw new BadRequestException('MT5_SYNC_COMMAND env is required');
    }

    const { stdout } = await execAsync(syncCommand, {
      env: {
        PATH: process.env.PATH ?? '',
        MT5_ACCOUNT_NUMBER: accountNumber,
        MT5_READ_ONLY_PASSWORD: readOnlyPassword,
      },
      maxBuffer: 1024 * 1024,
    });

    const payloadText = stdout.trim();
    if (!payloadText) {
      throw new BadRequestException('MT5 sync command returned no output');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadText) as unknown;
    } catch {
      throw new BadRequestException('MT5 sync command must return JSON');
    }

    validateTradeLogAssistantActionsRequest(parsed, 'MT5 sync command returned invalid payload');

    const applied = await this.applyAssistantActions(parsed);
    return {
      source: 'mt5',
      syncedAt: new Date().toISOString(),
      importedCount: applied.trades.length,
      trades: applied.trades,
    };
  }

  private isTradeLogAssistantActionsRequest(value: unknown): value is TradeLogAssistantActionsRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.rawText === 'string' &&
      (candidate.source === 'telegram' || candidate.source === 'manual' || candidate.source === 'api') &&
      Array.isArray(candidate.actions) &&
      candidate.actions.every((action) => this.isTradeLogAssistantAction(action))
    );
  }

  private isTradeLogAssistantAction(value: unknown): value is TradeLogAssistantAction {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      candidate.type === 'create_trade' ||
      candidate.type === 'record_entry' ||
      candidate.type === 'record_exit' ||
      candidate.type === 'patch_trade_journal'
    );
  }

  private async findTradeOrThrow(client: PrismaService | Tx, id: string): Promise<TradeWithRelations> {
    const trade = await client.trade.findUnique({
      where: { id },
      ...tradeWithRelations,
    });
    if (!trade) {
      throw new NotFoundException(`Trade not found: ${id}`);
    }
    return trade;
  }

  private upsertTouchedTrade(trades: TradeRecord[], updated: TradeRecord): void {
    const index = trades.findIndex((trade) => trade.id === updated.id);
    if (index >= 0) {
      trades[index] = updated;
    } else {
      trades.push(updated);
    }
  }

  private mergeTradeJournal(
    existing: TradeJournalContext | undefined,
    patch: UpdateTradeJournalRequest,
  ): TradeJournalContext | undefined {
    const merged: TradeJournalContext = {
      plan: patch.plan ? { ...(existing?.plan ?? {}), ...patch.plan } : existing?.plan,
      management: patch.management
        ? { ...(existing?.management ?? {}), ...patch.management }
        : existing?.management,
      review: patch.review ? { ...(existing?.review ?? {}), ...patch.review } : existing?.review,
    };

    return this.compactTradeJournal(merged);
  }

  private compactTradeJournal(journal: TradeJournalContext | undefined): TradeJournalContext | undefined {
    if (!journal) {
      return undefined;
    }

    const compacted: TradeJournalContext = {};

    if (journal.plan && Object.keys(journal.plan).length > 0) {
      compacted.plan = journal.plan;
    }
    if (journal.management && Object.keys(journal.management).length > 0) {
      compacted.management = journal.management;
    }
    if (journal.review && Object.keys(journal.review).length > 0) {
      compacted.review = journal.review;
    }

    return Object.keys(compacted).length > 0 ? compacted : undefined;
  }

  private normalizeTradeJournal(
    journal: unknown,
    context?: { timeframe?: string; thesis?: string; note?: string },
  ): TradeJournalContext | undefined {
    if (!journal || typeof journal !== 'object' || Array.isArray(journal)) {
      return undefined;
    }

    const normalized = this.compactTradeJournal(journal as TradeJournalContext);
    if (!normalized) {
      return undefined;
    }

    const setupTags = this.extractSetupTagLabels(normalized, context);
    const ruleViolationTags = this.extractRuleViolationTagLabels(normalized);
    const lessonTags = this.extractLessonTagLabels(normalized);
    const resultLabel = this.extractResultLabel(normalized);

    return this.compactTradeJournal({
      ...normalized,
      plan: normalized.plan
        ? {
            ...normalized.plan,
            setupTag: setupTags[0],
            setupTags,
          }
        : normalized.plan,
      review: normalized.review
        ? {
            ...normalized.review,
            resultLabel,
            ruleViolationTags,
            lessonTags,
          }
        : resultLabel || ruleViolationTags.length > 0 || lessonTags.length > 0
          ? {
              resultLabel,
              ruleViolationTags,
              lessonTags,
            }
          : normalized.review,
    });
  }

  private normalizeLookupKey(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  private normalizeDisplayLabel(value: string | undefined): string {
    return (value ?? '').trim().replace(/\s+/g, ' ');
  }

  private uniqueLabels(values: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const value of values) {
      const label = this.normalizeDisplayLabel(value);
      if (!label) {
        continue;
      }
      const key = this.normalizeLookupKey(label);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      labels.push(label);
    }
    return labels;
  }

  private prunePlanTags(plan: NonNullable<TradeJournalContext['plan']>): NonNullable<TradeJournalContext['plan']> {
    const { setupTag: _setupTag, setupTags: _setupTags, ...rest } = plan;
    return rest;
  }

  private pruneReviewTags(review: NonNullable<TradeJournalContext['review']>): NonNullable<TradeJournalContext['review']> {
    const { resultLabel: _resultLabel, ruleViolationTags: _ruleViolationTags, lessonTags: _lessonTags, ...rest } = review;
    return rest;
  }

  private stripStoredTradeJournal(journal: TradeJournalContext | undefined): TradeJournalContext | undefined {
    if (!journal) {
      return undefined;
    }

    return this.compactTradeJournal({
      ...journal,
      plan: journal.plan ? this.prunePlanTags(journal.plan) : journal.plan,
      review: journal.review ? this.pruneReviewTags(journal.review) : journal.review,
    });
  }

  private canonicalizeSetupLabel(label: string): string {
    return SETUP_TAG_ALIASES[this.normalizeLookupKey(label)] ?? this.normalizeDisplayLabel(label);
  }

  private canonicalizeReviewLabel(label: string): string {
    return REVIEW_TAG_ALIASES[this.normalizeLookupKey(label)] ?? this.normalizeDisplayLabel(label);
  }

  private canonicalizeResultLabel(label: string): string {
    return this.normalizeDisplayLabel(label);
  }

  private extractSetupTagLabels(
    journal: TradeJournalContext | undefined,
    context?: { thesis?: string; note?: string },
  ): string[] {
    if (!journal?.plan) {
      return [];
    }

    const provided = this.uniqueLabels([
      ...(journal.plan.setupTags ?? []),
      journal.plan.setupTag,
    ]).map((label) => this.canonicalizeSetupLabel(label));

    return provided.length > 0
      ? this.uniqueLabels(provided)
      : this.uniqueLabels(this.inferSetupTags(journal.plan.setupType, context?.thesis, context?.note));
  }

  private extractRuleViolationTagLabels(journal: TradeJournalContext | undefined): string[] {
    if (!journal?.review) {
      return [];
    }

    const provided = this.uniqueLabels(journal.review.ruleViolationTags ?? []).map((label) =>
      this.canonicalizeReviewLabel(label),
    );

    return provided.length > 0 ? this.uniqueLabels(provided) : this.uniqueLabels(this.inferReviewTags(journal.review.ruleViolations, 'violation'));
  }

  private extractLessonTagLabels(journal: TradeJournalContext | undefined): string[] {
    if (!journal?.review) {
      return [];
    }

    const provided = this.uniqueLabels(journal.review.lessonTags ?? []).map((label) => this.canonicalizeReviewLabel(label));

    return provided.length > 0 ? this.uniqueLabels(provided) : this.uniqueLabels(this.inferReviewTags(journal.review.lessons, 'lesson'));
  }

  private extractResultLabel(journal: TradeJournalContext | undefined): string | undefined {
    const label = journal?.review?.resultLabel;
    return label ? this.canonicalizeResultLabel(label) : undefined;
  }

  private async resolveTradeTagRefs(
    tx: Tx,
    journal: TradeJournalContext | undefined,
    context?: { thesis?: string; note?: string },
  ): Promise<NonNullable<TradeRecord['tags']>> {
    const setupLabels = this.extractSetupTagLabels(journal, context);
    const ruleViolationLabels = this.extractRuleViolationTagLabels(journal);
    const lessonLabels = this.extractLessonTagLabels(journal);
    const resultLabel = this.extractResultLabel(journal);

    const [setupTags, ruleViolationTags, lessonTags, resultLabelTags] = await Promise.all([
      this.ensureTagDefinitions(tx, 'setup', setupLabels),
      this.ensureTagDefinitions(tx, 'rule-violation', ruleViolationLabels),
      this.ensureTagDefinitions(tx, 'lesson', lessonLabels),
      resultLabel ? this.ensureTagDefinitions(tx, 'result-label', [resultLabel]) : Promise.resolve([]),
    ]);

    return {
      setupTags,
      ruleViolationTags,
      lessonTags,
      resultLabel: resultLabelTags[0],
    };
  }

  private async ensureTagDefinitions(tx: Tx, field: TradeTagField, labels: string[]): Promise<TradeTagDefinition[]> {
    const canonicalLabels = this.uniqueLabels(
      labels.map((label) => {
        if (field === 'setup') return this.canonicalizeSetupLabel(label);
        if (field === 'result-label') return this.canonicalizeResultLabel(label);
        return this.canonicalizeReviewLabel(label);
      }),
    );

    if (canonicalLabels.length === 0) {
      return [];
    }

    const rows = canonicalLabels.map((label) => ({
      label,
      normalizedLabel: this.normalizeLookupKey(label),
      systemDefined: this.isSystemDefinedTag(field, label),
    }));

    switch (field) {
      case 'setup': {
        await tx.setupTagDefinition.createMany({ data: rows, skipDuplicates: true });
        const found = await tx.setupTagDefinition.findMany({
          where: { normalizedLabel: { in: rows.map((row) => row.normalizedLabel) } },
        });
        return this.sortTagDefinitions(canonicalLabels, found.map((row) => this.toTagDefinition(row)));
      }
      case 'rule-violation': {
        await tx.ruleViolationTagDefinition.createMany({ data: rows, skipDuplicates: true });
        const found = await tx.ruleViolationTagDefinition.findMany({
          where: { normalizedLabel: { in: rows.map((row) => row.normalizedLabel) } },
        });
        return this.sortTagDefinitions(canonicalLabels, found.map((row) => this.toTagDefinition(row)));
      }
      case 'lesson': {
        await tx.lessonTagDefinition.createMany({ data: rows, skipDuplicates: true });
        const found = await tx.lessonTagDefinition.findMany({
          where: { normalizedLabel: { in: rows.map((row) => row.normalizedLabel) } },
        });
        return this.sortTagDefinitions(canonicalLabels, found.map((row) => this.toTagDefinition(row)));
      }
      case 'result-label': {
        await tx.resultLabelTagDefinition.createMany({ data: rows, skipDuplicates: true });
        const found = await tx.resultLabelTagDefinition.findMany({
          where: { normalizedLabel: { in: rows.map((row) => row.normalizedLabel) } },
        });
        return this.sortTagDefinitions(canonicalLabels, found.map((row) => this.toTagDefinition(row)));
      }
      default:
        throw new BadRequestException(`Unsupported tag field: ${field}`);
    }
  }

  private sortTagDefinitions(labels: string[], definitions: TradeTagDefinition[]): TradeTagDefinition[] {
    const byKey = new Map(definitions.map((definition) => [definition.normalizedLabel, definition]));
    return labels.map((label) => byKey.get(this.normalizeLookupKey(label))).filter(Boolean) as TradeTagDefinition[];
  }

  private isSystemDefinedTag(field: TradeTagField, label: string): boolean {
    if (field === 'setup') {
      return Object.values(SETUP_TAG_ALIASES).includes(label);
    }
    if (field === 'result-label') {
      return DEFAULT_RESULT_LABELS.has(label);
    }
    return Object.values(REVIEW_TAG_ALIASES).includes(label);
  }

  private toSetupTagLinkCreate(tags: TradeTagDefinition[]): Prisma.TradeCreateInput['setupTagLinks'] | undefined {
    return tags.length > 0 ? { create: tags.map((tag) => ({ tag: { connect: { id: tag.id } } })) } : undefined;
  }

  private toRuleViolationTagLinkCreate(
    tags: TradeTagDefinition[],
  ): Prisma.TradeCreateInput['ruleViolationTagLinks'] | undefined {
    return tags.length > 0 ? { create: tags.map((tag) => ({ tag: { connect: { id: tag.id } } })) } : undefined;
  }

  private toLessonTagLinkCreate(tags: TradeTagDefinition[]): Prisma.TradeCreateInput['lessonTagLinks'] | undefined {
    return tags.length > 0 ? { create: tags.map((tag) => ({ tag: { connect: { id: tag.id } } })) } : undefined;
  }

  private toSetupTagLinkReplace(tags: TradeTagDefinition[]): Prisma.TradeUpdateInput['setupTagLinks'] {
    return {
      deleteMany: {},
      ...(tags.length > 0 ? { create: tags.map((tag) => ({ tag: { connect: { id: tag.id } } })) } : {}),
    };
  }

  private toRuleViolationTagLinkReplace(tags: TradeTagDefinition[]): Prisma.TradeUpdateInput['ruleViolationTagLinks'] {
    return {
      deleteMany: {},
      ...(tags.length > 0 ? { create: tags.map((tag) => ({ tag: { connect: { id: tag.id } } })) } : {}),
    };
  }

  private toLessonTagLinkReplace(tags: TradeTagDefinition[]): Prisma.TradeUpdateInput['lessonTagLinks'] {
    return {
      deleteMany: {},
      ...(tags.length > 0 ? { create: tags.map((tag) => ({ tag: { connect: { id: tag.id } } })) } : {}),
    };
  }

  private inferSetupTags(setupType: string | undefined, thesis?: string, note?: string): string[] {
    const text = [setupType, thesis, note].filter(Boolean).join(' ');
    const normalized = this.normalizeLookupKey(text);

    if (!normalized) {
      return ['없음'];
    }
    if (normalized.includes('없음') || normalized.includes('nosetup')) {
      return ['없음'];
    }
    if (normalized.includes('테스트') || normalized.includes('실험') || normalized.includes('test')) {
      return ['테스트'];
    }
    if (normalized.includes('투볼') && normalized.includes('정볼')) {
      return ['투볼 정볼'];
    }
    if (normalized.includes('투볼') && normalized.includes('역볼')) {
      return ['투볼 역볼'];
    }
    if (normalized.includes('원볼') && normalized.includes('정볼')) {
      return ['원볼 정볼'];
    }
    if (normalized.includes('원볼') && normalized.includes('역볼')) {
      return ['원볼 역볼'];
    }
    if (normalized.includes('정볼')) {
      return ['정볼'];
    }
    if (normalized.includes('역볼')) {
      return ['역볼'];
    }
    if (normalized.includes('투볼')) {
      return ['투볼'];
    }
    if (normalized.includes('원볼')) {
      return ['원볼'];
    }
    if (normalized.includes('눌림') || normalized.includes('pullback')) {
      return ['추세 눌림'];
    }
    if (normalized.includes('돌파') || normalized.includes('breakout') || normalized.includes('sma')) {
      return ['돌파'];
    }
    return ['기타'];
  }

  private inferReviewTags(items: string[] | undefined, category: 'violation' | 'lesson'): string[] {
    const tags: string[] = [];
    for (const item of items ?? []) {
      const normalized = this.normalizeLookupKey(item);
      const mapped: string[] = [];

      if (normalized.includes('기준봉') || normalized.includes('15분봉') || normalized.includes('30분봉')) {
        mapped.push(category === 'violation' ? '기준봉/관리봉 불일치' : '진입 기준봉으로 관리 유지');
      }
      if (normalized.includes('1분봉지지') || normalized.includes('1분봉캔들') || normalized.includes('하위타임프레임')) {
        mapped.push(category === 'violation' ? '하위 타임프레임 과신' : '진입 기준봉으로 관리 유지');
      }
      if (normalized.includes('손절가') || normalized.includes('손절') || normalized.includes('노이즈')) {
        mapped.push(category === 'violation' ? '손절 폭 과도하게 짧음' : '구조 기준 손절 사용');
      }
      if (normalized.includes('sl을옮기') || normalized.includes('sl을이동') || normalized.includes('빠르게sl')) {
        mapped.push('SL 조기 이동');
      }
      if (normalized.includes('추세') && (normalized.includes('오판') || normalized.includes('착각') || normalized.includes('재확인'))) {
        mapped.push(category === 'violation' ? '추세 해석 오류' : '재진입 전 추세 재검증');
      }
      if (normalized.includes('저항')) {
        mapped.push(category === 'violation' ? '상위 저항 반영 부족' : '상위 타임프레임 합치 확인');
      }
      if (normalized.includes('역볼') && normalized.includes('빠르게익절')) {
        mapped.push('역추세는 빠른 익절 우선');
      }
      if (normalized.includes('관리') && normalized.includes('기준')) {
        mapped.push(category === 'violation' ? '기준봉/관리봉 불일치' : '진입 기준봉으로 관리 유지');
      }
      if (normalized.includes('봉마감')) {
        mapped.push(category === 'violation' ? '봉마감 확인 없이 진입' : '필수 진입 확인 조건 유지');
      }
      if (normalized.includes('볼추이지캔') || normalized.includes('필수entrycondition') || normalized.includes('필수진입조건')) {
        mapped.push(category === 'violation' ? '필수 진입 확인 부재' : '필수 진입 확인 조건 유지');
      }
      if (normalized.includes('자체조건') || (normalized.includes('조건') && normalized.includes('충족'))) {
        mapped.push(category === 'violation' ? '필수 진입 확인 부재' : '필수 진입 확인 조건 유지');
      }
      if (normalized.includes('독립검증')) {
        mapped.push('하위 setup 독립 검증 부재');
      }
      if (normalized.includes('재진입')) {
        mapped.push(category === 'violation' ? '재진입 전 재검증 부족' : '재진입 전 추세 재검증');
      }
      if (normalized.includes('방향판단') && normalized.includes('재검증')) {
        mapped.push('재진입 전 추세 재검증');
      }
      if (normalized.includes('물려있는상태') || normalized.includes('판단품질저하')) {
        mapped.push('보유 중 판단 품질 저하');
      }
      if (normalized.includes('정당화하면안') || normalized.includes('정당화하지않') || normalized.includes('정당화되지않')) {
        mapped.push('결과로 나쁜 프로세스 정당화 금지');
      }
      if (normalized.includes('계획tp전청산') || normalized.includes('가격행동약화')) {
        mapped.push('무효화 기준 명확화');
      }
      if (normalized.includes('목표') || normalized.includes('익절계획') || normalized.includes('vp') || normalized.includes('피보나치')) {
        mapped.push(category === 'violation' ? '목표 계획 정합성 부족' : '목표를 구조 합치로 정의');
      }
      if (normalized.includes('진입품질') || normalized.includes('기대를버티지못')) {
        mapped.push(category === 'violation' ? 'setup 대비 관리 방식 불일치' : '결과로 나쁜 프로세스 정당화 금지');
      }
      if (normalized.includes('구조')) {
        mapped.push('구조 기준 손절 사용');
      }
      if (normalized.includes('무효화') || normalized.includes('직전고점') || normalized.includes('직전저점')) {
        mapped.push('무효화 기준 명확화');
      }
      if (normalized.includes('독립trade') || normalized.includes('독립trade로') || normalized.includes('독립거래')) {
        mapped.push('독립 trade 분리 유지');
      }
      if (normalized.includes('테스트성') || normalized.includes('실험목적')) {
        mapped.push('테스트성 거래 분리 관리');
      }
      if (normalized.includes('자본보호') || normalized.includes('모니터링불가')) {
        mapped.push('자본 보호 우선 관리');
      }
      if (normalized.includes('손절가격대')) {
        mapped.push('손절 위치 부적절');
      }
      if (normalized.includes('관리로처리')) {
        mapped.push('setup 대비 관리 방식 불일치');
      }

      tags.push(...mapped);
      if (mapped.length === 0) {
        tags.push(category === 'violation' ? '기타 리뷰 이슈' : '기타 리뷰 교훈');
      }
    }

    return this.uniqueLabels(tags);
  }

  private detectSessionFromOccurredAt(occurredAt: Date): string {
    if (this.isWithinSessionHours(occurredAt, 'America/New_York', 8, 17)) {
      return 'New York';
    }
    if (this.isWithinSessionHours(occurredAt, 'Europe/London', 8, 17)) {
      return 'London';
    }
    if (this.isWithinSessionHours(occurredAt, 'Asia/Seoul', 9, 16)) {
      return 'Asia';
    }
    return 'Off session';
  }

  private isWithinSessionHours(occurredAt: Date, timeZone: string, startHour: number, endHourExclusive: number): boolean {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hour12: false,
        timeZone,
      }).format(occurredAt),
    );

    return hour >= startHour && hour < endHourExclusive;
  }

  private buildChecklistRates(trades: TradeRecord[]): TradeChecklistRates {
    const total = trades.length;

    return {
      stopLossDefinedRate: this.toRate(
        trades.filter((trade) => trade.journal?.plan?.stopLossPrice !== undefined).length,
        total,
      ),
      takeProfitDefinedRate: this.toRate(
        trades.filter((trade) => trade.journal?.plan?.takeProfitPrice !== undefined).length,
        total,
      ),
      confirmationsAtLeastThreeRate: this.toRate(
        trades.filter((trade) => (trade.journal?.plan?.confirmations?.length ?? 0) >= 3).length,
        total,
      ),
      calmStateRate: this.toRate(
        trades.filter((trade) => trade.journal?.plan?.calmState === true).length,
        total,
      ),
      ruleViolationTaggedRate: this.toRate(
        trades.filter((trade) => (trade.journal?.review?.ruleViolationTags?.length ?? 0) > 0).length,
        total,
      ),
      lessonsTaggedRate: this.toRate(
        trades.filter((trade) => (trade.journal?.review?.lessonTags?.length ?? 0) > 0).length,
        total,
      ),
    };
  }

  private collectTopTags(
    trades: TradeRecord[],
    extractor: (trade: TradeRecord) => string[] | undefined,
    limit = 5,
  ): TradeTagCount[] {
    const counts = new Map<string, number>();

    for (const trade of trades) {
      for (const tag of extractor(trade) ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([tag, count]) => ({ label: tag, count }));
  }

  private buildBreakdown<TTag extends string>(
    trades: TradeRecord[],
    selector: (trade: TradeRecord) => Array<{ key: TTag; label: string }>,
  ): TradeStatsBucket[] {
    const buckets = new Map<string, TradeStatsBucket>();

    for (const trade of trades) {
      const realizedPoints = this.calculateRealizedPoints(trade);
      for (const selected of selector(trade)) {
        const bucket =
          buckets.get(selected.key) ??
          {
            key: selected.key,
            label: selected.label,
            count: 0,
            winRate: 0,
            realizedPoints: 0,
            goodCount: 0,
            observeCount: 0,
            badCount: 0,
            repeatBanCount: 0,
          };

        bucket.count += 1;
        const verdict = trade.journal?.review?.processVerdict;
        if (verdict === 'good') bucket.goodCount += 1;
        if (verdict === 'observe') bucket.observeCount += 1;
        if (verdict === 'bad') bucket.badCount += 1;
        if (verdict === 'repeat-ban') bucket.repeatBanCount += 1;
        bucket.realizedPoints += realizedPoints;
        if (realizedPoints > 0) {
          bucket.winRate += 1;
        }

        buckets.set(selected.key, bucket);
      }
    }

    return Array.from(buckets.values())
      .map((bucket) => ({
        ...bucket,
        winRate: this.toRate(bucket.winRate, bucket.count),
        realizedPoints: this.roundStat(bucket.realizedPoints),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  private classifySession(value: string | undefined): { key: 'asia' | 'london' | 'new-york' | 'off-session' | 'other'; label: string } {
    const normalized = value?.trim().toLowerCase();
    if (normalized === 'asia') {
      return { key: 'asia', label: 'Asia' };
    }
    if (normalized === 'london') {
      return { key: 'london', label: 'London' };
    }
    if (normalized === 'new york' || normalized === 'new-york' || normalized === 'newyork') {
      return { key: 'new-york', label: 'New York' };
    }
    if (normalized === 'off session' || normalized === 'off-session' || normalized === 'offsession') {
      return { key: 'off-session', label: 'Off session' };
    }
    return { key: 'other', label: 'Other' };
  }

  private classifyTimeframe(trade: TradeRecord): { key: TradeTimeframeTag; label: string } {
    const normalized = this.normalizeLookupKey(
      trade.timeframe ?? trade.journal?.plan?.setupType ?? trade.thesis ?? trade.note,
    );
    const aliases: Record<string, TradeTimeframeTag> = {
      '1m': '1m',
      '1min': '1m',
      '1분': '1m',
      '1분봉': '1m',
      '5m': '5m',
      '5min': '5m',
      '5분': '5m',
      '5분봉': '5m',
      '15m': '15m',
      '15min': '15m',
      '15분': '15m',
      '15분봉': '15m',
      '30m': '30m',
      '30min': '30m',
      '30분': '30m',
      '30분봉': '30m',
      '1h': '1h',
      '60m': '1h',
      '60분': '1h',
      '60분봉': '1h',
      '1시간': '1h',
      '1시간봉': '1h',
      '4h': '4h',
      '240m': '4h',
      '4시간': '4h',
      '4시간봉': '4h',
      '1d': '1d',
      day: '1d',
      daily: '1d',
      일봉: '1d',
    };

    for (const [needle, key] of Object.entries(aliases)) {
      if (normalized.includes(needle)) {
        return { key, label: key };
      }
    }

    return { key: 'other', label: 'Other' };
  }

  private classifySetupTags(trade: TradeRecord): Array<{ key: string; label: string }> {
    const tags = trade.journal?.plan?.setupTags?.length
      ? trade.journal.plan.setupTags
      : this.inferSetupTags(trade.journal?.plan?.setupType, trade.thesis, trade.note);

    return tags.map((key) => ({ key, label: key }));
  }

  private calculateRealizedPoints(trade: TradeRecord): number {
    if (!trade.entry || !trade.exit) {
      return 0;
    }

    const raw = trade.side === 'long' ? trade.exit.price - trade.entry.price : trade.entry.price - trade.exit.price;
    return this.roundStat(raw);
  }

  private toRate(part: number, total: number): number {
    if (total === 0) {
      return 0;
    }
    return this.roundStat((part / total) * 100);
  }

  private roundStat(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private toPrismaJson(journal: TradeJournalContext | undefined): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (!journal) {
      return Prisma.JsonNull;
    }

    return journal as Prisma.InputJsonValue;
  }

  private toTagDefinition(row: TagDefinitionRow): TradeTagDefinition {
    return {
      id: row.id,
      field: this.fromPrismaTagField(row.field),
      label: row.label,
      normalizedLabel: row.normalizedLabel,
      systemDefined: row.systemDefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private fromPrismaTagField(value: unknown): TradeTagField {
    switch (String(value)) {
      case 'SETUP':
        return 'setup';
      case 'RULE_VIOLATION':
        return 'rule-violation';
      case 'LESSON':
        return 'lesson';
      case 'RESULT_LABEL':
        return 'result-label';
      default:
        throw new BadRequestException(`Unsupported Prisma tag field: ${String(value)}`);
    }
  }

  private toPrismaTradeSide(side: TradeRecord['side']): PrismaTradeSide {
    return side === 'long' ? PrismaTradeSide.LONG : PrismaTradeSide.SHORT;
  }

  private fromPrismaTradeSide(side: PrismaTradeSide): TradeRecord['side'] {
    return side === PrismaTradeSide.LONG ? 'long' : 'short';
  }

  private fromPrismaTradeStatus(status: PrismaTradeStatus): TradeRecord['status'] {
    switch (status) {
      case PrismaTradeStatus.PLANNED:
        return 'planned';
      case PrismaTradeStatus.OPEN:
        return 'open';
      case PrismaTradeStatus.CLOSED:
        return 'closed';
      case PrismaTradeStatus.CANCELLED:
        return 'cancelled';
      default:
        return 'planned';
    }
  }

  private toTradeRecord(trade: TradeWithRelations): TradeRecord {
    const inferredSession = trade.entry ? this.detectSessionFromOccurredAt(trade.entry.occurredAt) : undefined;
    const normalizedJournal = this.normalizeTradeJournal(trade.journal, {
      timeframe: trade.timeframe ?? undefined,
      thesis: trade.thesis ?? undefined,
      note: trade.note ?? undefined,
    });

    const setupTags = trade.setupTagLinks.length > 0
      ? trade.setupTagLinks.map((link) => this.toTagDefinition(link.tag))
      : this.uniqueLabels(this.extractSetupTagLabels(normalizedJournal, { thesis: trade.thesis ?? undefined, note: trade.note ?? undefined })).map((label, index) => ({
          id: -1 - index,
          field: 'setup' as const,
          label,
          normalizedLabel: this.normalizeLookupKey(label),
          systemDefined: this.isSystemDefinedTag('setup', label),
          createdAt: trade.createdAt.toISOString(),
          updatedAt: trade.updatedAt.toISOString(),
        }));
    const ruleViolationTags = trade.ruleViolationTagLinks.length > 0
      ? trade.ruleViolationTagLinks.map((link) => this.toTagDefinition(link.tag))
      : this.uniqueLabels(this.extractRuleViolationTagLabels(normalizedJournal)).map((label, index) => ({
          id: -101 - index,
          field: 'rule-violation' as const,
          label,
          normalizedLabel: this.normalizeLookupKey(label),
          systemDefined: this.isSystemDefinedTag('rule-violation', label),
          createdAt: trade.createdAt.toISOString(),
          updatedAt: trade.updatedAt.toISOString(),
        }));
    const lessonTags = trade.lessonTagLinks.length > 0
      ? trade.lessonTagLinks.map((link) => this.toTagDefinition(link.tag))
      : this.uniqueLabels(this.extractLessonTagLabels(normalizedJournal)).map((label, index) => ({
          id: -201 - index,
          field: 'lesson' as const,
          label,
          normalizedLabel: this.normalizeLookupKey(label),
          systemDefined: this.isSystemDefinedTag('lesson', label),
          createdAt: trade.createdAt.toISOString(),
          updatedAt: trade.updatedAt.toISOString(),
        }));
    const resultLabelTag = trade.resultLabelTag ? this.toTagDefinition(trade.resultLabelTag) : undefined;

    const journal = this.compactTradeJournal({
      ...normalizedJournal,
      plan: normalizedJournal?.plan
        ? {
            ...normalizedJournal.plan,
            setupTag: setupTags[0]?.label,
            setupTags: setupTags.map((tag) => tag.label),
          }
        : normalizedJournal?.plan,
      review: normalizedJournal?.review
        ? {
            ...normalizedJournal.review,
            resultLabel: resultLabelTag?.label,
            ruleViolationTags: ruleViolationTags.map((tag) => tag.label),
            lessonTags: lessonTags.map((tag) => tag.label),
          }
        : resultLabelTag || ruleViolationTags.length > 0 || lessonTags.length > 0
          ? {
              ...(normalizedJournal?.review ?? {}),
              resultLabel: resultLabelTag?.label,
              ruleViolationTags: ruleViolationTags.map((tag) => tag.label),
              lessonTags: lessonTags.map((tag) => tag.label),
            }
          : normalizedJournal?.review,
    });

    return {
      id: trade.id,
      symbol: trade.symbol,
      side: this.fromPrismaTradeSide(trade.side),
      status: this.fromPrismaTradeStatus(trade.status),
      timeframe: trade.timeframe ?? undefined,
      session: inferredSession ?? trade.session ?? undefined,
      strategy: trade.strategy ?? undefined,
      thesis: trade.thesis ?? undefined,
      note: trade.note ?? undefined,
      journal,
      tags: {
        setupTags,
        ruleViolationTags,
        lessonTags,
        resultLabel: resultLabelTag,
      },
      entry: trade.entry
        ? {
            price: trade.entry.price.toNumber(),
            quantity: trade.entry.quantity?.toNumber(),
            occurredAt: trade.entry.occurredAt.toISOString(),
            note: trade.entry.note ?? undefined,
          }
        : undefined,
      exit: trade.exit
        ? {
            price: trade.exit.price.toNumber(),
            quantity: trade.exit.quantity?.toNumber(),
            occurredAt: trade.exit.occurredAt.toISOString(),
            reason: trade.exit.reason as TradeRecord['exit'] extends infer Exit
              ? Exit extends { reason?: infer Reason }
                ? Reason
                : never
              : never,
            note: trade.exit.note ?? undefined,
          }
        : undefined,
      createdAt: trade.createdAt.toISOString(),
      updatedAt: trade.updatedAt.toISOString(),
    };
  }
}
