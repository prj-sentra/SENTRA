import type {
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeLogMt5SyncResponse,
  TradeRecord,
  TradeStatsResponse,
  UpdateTradeJournalRequest,
} from '@trading-journal/shared';
import { TradeLogController } from './trade-log.controller';

describe('TradeLogController', () => {
  it('exposes assistant actions over HTTP controller contract', async () => {
    const response: TradeLogAssistantActionsResponse = {
      rawText: 'BTC 15분봉 롱 진입했어. 67320에 0.05개.',
      source: 'telegram',
      trades: [
        {
          id: 'trade-1',
          symbol: 'BTCUSDT',
          side: 'long',
          status: 'open',
          timeframe: '15m',
          entry: {
            price: 67320,
            quantity: 0.05,
            occurredAt: '2026-06-29T00:00:00.000Z',
          },
          createdAt: '2026-06-29T00:00:00.000Z',
          updatedAt: '2026-06-29T00:00:00.000Z',
        },
      ],
    };
    const service = {
      applyAssistantActions: jest.fn<Promise<TradeLogAssistantActionsResponse>, [TradeLogAssistantActionsRequest]>(() =>
        Promise.resolve(response),
      ),
    };
    const controller = new TradeLogController(service as never);

    await expect(
      controller.applyAssistantActions({
        rawText: 'BTC 15분봉 롱 진입했어. 67320에 0.05개.',
        source: 'telegram',
        actions: [
          {
            type: 'create_trade',
            payload: { symbol: 'BTCUSDT', side: 'long', timeframe: '15m' },
          },
          {
            type: 'record_entry',
            tradeRef: 'last_created',
            payload: {
              price: 67320,
              quantity: 0.05,
              occurredAt: '2026-06-29T00:00:00.000Z',
            },
          },
        ],
      }),
    ).resolves.toMatchObject({
      rawText: 'BTC 15분봉 롱 진입했어. 67320에 0.05개.',
      source: 'telegram',
      trades: [
        {
          symbol: 'BTCUSDT',
          side: 'long',
          status: 'open',
          timeframe: '15m',
          entry: {
            price: 67320,
            quantity: 0.05,
            occurredAt: '2026-06-29T00:00:00.000Z',
          },
        },
      ],
    });
  });

  it('exposes journal patching over HTTP controller contract', async () => {
    const response: TradeRecord = {
      id: 'trade-1',
      symbol: 'XAUUSD',
      side: 'short',
      status: 'closed',
      journal: {
        review: {
          resultLabel: '본절 청산',
          realizedPnlText: '$0.06',
        },
      },
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:10:00.000Z',
    };
    const service = {
      patchTradeJournal: jest.fn<Promise<TradeRecord>, [string, UpdateTradeJournalRequest]>(() =>
        Promise.resolve(response),
      ),
    };
    const controller = new TradeLogController(service as never);

    await expect(
      controller.patchJournal('trade-1', {
        review: {
          resultLabel: '본절 청산',
          realizedPnlText: '$0.06',
        },
      }),
    ).resolves.toMatchObject({
      id: 'trade-1',
      journal: {
        review: {
          resultLabel: '본절 청산',
          realizedPnlText: '$0.06',
        },
      },
    });
  });

  it('exposes mt5 sync over HTTP controller contract', async () => {
    const response: TradeLogMt5SyncResponse = {
      source: 'mt5',
      syncedAt: '2026-07-11T08:30:00.000Z',
      importedCount: 1,
      trades: [
        {
          id: 'trade-1',
          symbol: 'GOLD',
          side: 'long',
          status: 'open',
          createdAt: '2026-07-11T08:30:00.000Z',
          updatedAt: '2026-07-11T08:30:00.000Z',
        },
      ],
    };
    const service = {
      syncMt5Trades: jest.fn<Promise<TradeLogMt5SyncResponse>, []>(() => Promise.resolve(response)),
    };
    const controller = new TradeLogController(service as never);

    await expect(controller.syncMt5Trades()).resolves.toMatchObject({
      source: 'mt5',
      importedCount: 1,
      trades: [{ symbol: 'GOLD' }],
    });
  });

  it('exposes trade stats over HTTP controller contract', async () => {
    const response: TradeStatsResponse = {
      overview: {
        totalTrades: 2,
        totalRealizedPoints: 8.3,
        averageRealizedPoints: 4.15,
        winRate: 50,
        goodCount: 1,
        observeCount: 0,
        badCount: 1,
        repeatBanCount: 0,
      },
      checklistRates: {
        stopLossDefinedRate: 100,
        takeProfitDefinedRate: 50,
        confirmationsAtLeastThreeRate: 50,
        calmStateRate: 50,
        ruleViolationTaggedRate: 50,
        lessonsTaggedRate: 100,
      },
      topRuleViolations: [{ label: 'timeframe_inconsistency', count: 1 }],
      topLessons: [{ label: '기준봉 유지', count: 2 }],
      topResultLabels: [{ label: '손절', count: 1 }],
      bySession: [{ key: 'asia', label: 'Asia', count: 2, winRate: 50, realizedPoints: 3.2, goodCount: 1, observeCount: 0, badCount: 1, repeatBanCount: 0 }],
      byTimeframe: [{ key: '5m', label: '5m', count: 2, winRate: 50, realizedPoints: 8.3, goodCount: 1, observeCount: 0, badCount: 1, repeatBanCount: 0 }],
      bySetupType: [{ key: '투볼', label: '투볼', count: 2, winRate: 50, realizedPoints: 8.3, goodCount: 1, observeCount: 0, badCount: 1, repeatBanCount: 0 }],
    };
    const service = {
      getStats: jest.fn<Promise<TradeStatsResponse>, []>(() => Promise.resolve(response)),
    };
    const controller = new TradeLogController(service as never);

    await expect(controller.stats()).resolves.toMatchObject({
      overview: {
        totalTrades: 2,
        totalRealizedPoints: 8.3,
        goodCount: 1,
      },
      topRuleViolations: [{ label: 'timeframe_inconsistency', count: 1 }],
    });
  });
});
