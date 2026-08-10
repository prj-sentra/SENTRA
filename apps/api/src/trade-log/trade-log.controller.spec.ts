import type { PatchTradeAnalysisRequest, PatchTradeCampaignMemoRequest, RelinkTradeCampaignRequest, ResolveCampaignConflictRequest, TradeCampaignDateResponse, TradeRecord, TradeStatsResponse } from '@trading-journal/shared';
import { TradeLogController } from './trade-log.controller';

function createController(service: object, chartImageService: object = {}): TradeLogController { return new TradeLogController(service as never, chartImageService as never); }
const user = { id: 'owner-1' } as never;
const tradeRecord = { id: 'trade-1', accountId: 'account-1', symbol: 'XAUUSD', side: 'long', status: 'planned', analysisComplete: false, analysis: { schemaVersion: 1, marketZoneEnabled: false, chartPatternObserved: false, retailPositionEnabled: false, fibonacciEnabled: false, economicIndicators: [], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' } satisfies TradeRecord;
const tradeStats: TradeStatsResponse = { overview: { totalTrades: 1, totalRealizedPnl: 0, averageRealizedPnl: 0, winRate: 0, totalRiskAmount: 0, riskAmountCount: 0, averageRiskPercent: 0, riskPercentCount: 0 }, bySession: [], byBaseTimeframe: [] };

describe('TradeLogController', () => {
  it('forwards analysis patches to the service', async () => {
    const service = { patchTradeAnalysis: jest.fn().mockResolvedValue(tradeRecord) }; const controller = createController(service);
    const request: PatchTradeAnalysisRequest = { expectedUpdatedAt: '2026-08-01T00:00:00.000Z', marketZoneEnabled: true, marketZoneHigh: 120, marketZoneLow: 100, economicIndicators: [{ type: 'CPI', impact: 'negative' }] };
    await expect(controller.patchAnalysis(user, 'trade-1', 'account-1', request)).resolves.toBe(tradeRecord);
    expect(service.patchTradeAnalysis).toHaveBeenCalledWith('owner-1', 'account-1', 'trade-1', request);
  });
  it('forwards campaign memo patches to the service', async () => {
    const service = { patchCampaignMemo: jest.fn().mockResolvedValue(undefined) };
    const controller = createController(service);
    const request: PatchTradeCampaignMemoRequest = { memo: '복기 메모', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' };
    await expect(controller.patchCampaignMemo(user, 'campaign-1', 'account-1', request)).resolves.toBeUndefined();
    expect(service.patchCampaignMemo).toHaveBeenCalledWith('owner-1', 'account-1', 'campaign-1', request);
  });
  it('requires selected account forwarding for dated campaigns', async () => {
    const response = { date: '2026-08-01', campaigns: [], diagnostics: { missingOpenedAtTradeIds: [] } } as TradeCampaignDateResponse;
    const service = { listCampaigns: jest.fn().mockResolvedValue(response) }; const controller = createController(service);
    await expect(controller.campaigns(user, '2026-08-01', 'account-1')).resolves.toBe(response);
    expect(service.listCampaigns).toHaveBeenCalledWith('owner-1', '2026-08-01', 'account-1');
  });
  it('exposes campaign relinking and conflict resolution', async () => {
    const service = { relinkCampaign: jest.fn().mockResolvedValue(undefined), resolveCampaignConflict: jest.fn().mockResolvedValue(undefined) }; const controller = createController(service);
    const relink: RelinkTradeCampaignRequest = { accountId: 'account-1', tradeId: 'trade-1', campaignId: 'campaign-1' }; const resolution: ResolveCampaignConflictRequest = { accountId: 'account-1', campaignId: 'campaign-1' };
    await expect(controller.relinkCampaign(user, relink)).resolves.toBeUndefined(); await expect(controller.resolveCampaignConflict(user, 'conflict-1', resolution)).resolves.toBeUndefined();
    expect(service.relinkCampaign).toHaveBeenCalledWith('owner-1', relink); expect(service.resolveCampaignConflict).toHaveBeenCalledWith('owner-1', 'conflict-1', resolution);
  });
  it('forwards account-scoped stats and durable image upload IDs', async () => {
    const service = { getStats: jest.fn().mockResolvedValue(tradeStats) }; const image = { id: 'image-1', campaignId: 'campaign-1', position: 0 };
    const gallery = { upload: jest.fn().mockResolvedValue(image), remove: jest.fn().mockResolvedValue(undefined) }; const controller = createController(service, gallery); const file = { originalname: 'chart.webp' } as Express.Multer.File;
    await expect(controller.stats(user, 'account-1')).resolves.toBe(tradeStats); await expect(controller.uploadImage(user, 'campaign-1', 'account-1', file, '75442448-0d9f-4f4b-a3e6-1ed53118a7ec')).resolves.toBe(image); await expect(controller.removeImage(user, 'campaign-1', 'image-1', 'account-1')).resolves.toBeUndefined();
    expect(service.getStats).toHaveBeenCalledWith('owner-1', 'account-1'); expect(gallery.upload).toHaveBeenCalledWith('owner-1', 'account-1', 'campaign-1', '75442448-0d9f-4f4b-a3e6-1ed53118a7ec', file); expect(gallery.remove).toHaveBeenCalledWith('owner-1', 'account-1', 'campaign-1', 'image-1');
  });
});
