import type {
  PatchTradeAnalysisRequest,
  RelinkTradeCampaignRequest,
  ResolveCampaignConflictRequest,
  TradeCampaignDateResponse,
  TradeRecord,
  TradeStatsResponse,
  UpdateTradeExecutionNoteRequest,
} from '@trading-journal/shared';
import { TradeLogController } from './trade-log.controller';

function createController(service: object, chartImageService: object = {}): TradeLogController {
  return new TradeLogController(service as never, chartImageService as never);
}

const user = { id: 'owner-1' } as never;

const tradeRecord: TradeRecord = {
  id: 'trade-1',
  symbol: 'XAUUSD',
  side: 'long',
  status: 'planned',
  analysis: {
    schemaVersion: 1,
    marketZoneEnabled: false,
    chartPatternObserved: false,
    retailPositionEnabled: false,
    fibonacciEnabled: false,
    economicIndicators: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const tradeStats: TradeStatsResponse = {
  overview: {
    totalTrades: 1,
    totalRealizedPoints: 0,
    averageRealizedPoints: 0,
    winRate: 0,
    totalRiskAmount: 0,
    riskAmountCount: 0,
    averageRiskPercent: 0,
    riskPercentCount: 0,
  },
  bySession: [],
  byBaseTimeframe: [],
};

describe('TradeLogController', () => {

  it('forwards analysis patches to the service', async () => {
    const response = tradeRecord;
    const service = { patchTradeAnalysis: jest.fn().mockResolvedValue(response) };
    const controller = createController(service);
    const request: PatchTradeAnalysisRequest = {
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
      marketZoneEnabled: true,
      marketZoneHigh: 120,
      marketZoneLow: 100,
      economicIndicators: [{ type: 'CPI', impact: 'negative' }],
    };

    await expect(controller.patchAnalysis(user, 'trade-1', request)).resolves.toBe(response);
    expect(service.patchTradeAnalysis).toHaveBeenCalledWith('owner-1', 'trade-1', request);
  });
  it('exposes dated campaigns and note-only execution mutations', async () => {
    const response = { date: '2026-08-01', campaigns: [], diagnostics: { missingOpenedAtTradeIds: [] } } as TradeCampaignDateResponse;
    const service = {
      listCampaigns: jest.fn().mockResolvedValue(response),
      updateTradeEntryNote: jest.fn().mockResolvedValue(tradeRecord),
      updateTradeExitNote: jest.fn().mockResolvedValue(tradeRecord),
    };
    const controller = createController(service);
    const note: UpdateTradeExecutionNoteRequest = { note: 'kept with immutable execution' };

    await expect(controller.campaigns(user, '2026-08-01')).resolves.toBe(response);
    await expect(controller.updateEntryNote(user, 'trade-1', note)).resolves.toBe(tradeRecord);
    await expect(controller.updateExitNote(user, 'trade-1', note)).resolves.toBe(tradeRecord);
    expect(service.listCampaigns).toHaveBeenCalledWith('owner-1', '2026-08-01', { scope: undefined, accountId: undefined });
    expect(service.updateTradeEntryNote).toHaveBeenCalledWith('owner-1', 'trade-1', note);
    expect(service.updateTradeExitNote).toHaveBeenCalledWith('owner-1', 'trade-1', note);
  });

  it('exposes campaign relinking and conflict resolution', async () => {
    const service = { relinkCampaign: jest.fn().mockResolvedValue(undefined), resolveCampaignConflict: jest.fn().mockResolvedValue(undefined) };
    const controller = createController(service);
    const relink: RelinkTradeCampaignRequest = { tradeId: 'trade-1', campaignId: 'campaign-1' };
    const resolution: ResolveCampaignConflictRequest = { campaignId: 'campaign-1' };

    await expect(controller.relinkCampaign(user, relink)).resolves.toBeUndefined();
    await expect(controller.resolveCampaignConflict(user, 'conflict-1', resolution)).resolves.toBeUndefined();
    expect(service.relinkCampaign).toHaveBeenCalledWith('owner-1', relink);
    expect(service.resolveCampaignConflict).toHaveBeenCalledWith('owner-1', 'conflict-1', resolution);
  });

  it('exposes scoped stats and campaign gallery operations', async () => {
    const service = { getStats: jest.fn().mockResolvedValue(tradeStats) };
    const image = { id: 'image-1', campaignId: 'campaign-1', position: 0 };
    const gallery = {
      upload: jest.fn().mockResolvedValue(image),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = createController(service, gallery);
    const file = { originalname: 'chart.webp' } as Express.Multer.File;

    await expect(controller.stats(user, 'account', 'account-1')).resolves.toBe(tradeStats);
    await expect(controller.uploadImage(user, 'campaign-1', file)).resolves.toBe(image);
    await expect(controller.removeImage(user, 'campaign-1', 'image-1')).resolves.toBeUndefined();
    expect(service.getStats).toHaveBeenCalledWith('owner-1', { scope: 'account', accountId: 'account-1' });
    expect(gallery.upload).toHaveBeenCalledWith('owner-1', 'campaign-1', file);
    expect(gallery.remove).toHaveBeenCalledWith('owner-1', 'campaign-1', 'image-1');
  });
});
