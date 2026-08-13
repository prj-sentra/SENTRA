import type {
  CampaignPnlFamily,
  CampaignPnlMetrics,
  CampaignPriceFamily,
  CampaignPriceMetrics,
  ExcursionFailedAttempt,
  ExcursionSuccessProvenance,
  ExcursionSuccessfulAttempt,
  PortfolioExcursionPair,
} from './index.js';

declare const successfulAttempt: ExcursionSuccessfulAttempt;
declare const failedAttempt: ExcursionFailedAttempt;
declare const provenance: ExcursionSuccessProvenance;
declare const priceMetrics: CampaignPriceMetrics;
declare const pnlMetrics: CampaignPnlMetrics;
declare const r: PortfolioExcursionPair;

const stalePrice: CampaignPriceFamily = {
  family: 'campaign_price',
  status: 'stale',
  attempt: failedAttempt,
  success: provenance,
  metrics: priceMetrics,
};

// @ts-expect-error A current campaign family cannot expose a failed attempt.
const invalidCampaignStatus: CampaignPriceFamily = {
  family: 'campaign_price',
  status: 'success',
  attempt: failedAttempt,
  success: provenance,
  metrics: priceMetrics,
};

const invalidCampaignR: CampaignPnlFamily = {
  family: 'campaign_unrealized_pnl',
  status: 'success',
  attempt: successfulAttempt,
  success: provenance,
  metrics: {
    unrealizedPnl: pnlMetrics.unrealizedPnl,
    rAvailability: 'risk_unavailable',
    // @ts-expect-error R metrics are forbidden when the campaign reports risk unavailable.
    r,
  },
};

const portfolioWithMark: PortfolioExcursionPair = {
  mfe: {
    value: 1,
    occurredAt: '2026-01-01T00:00:00.000Z',
    // @ts-expect-error Portfolio extrema never expose an instrument mark price.
    markPrice: 100,
  },
  mae: { value: -1, occurredAt: '2026-01-01T00:00:01.000Z' },
};

// @ts-expect-error Available campaign risk requires R metrics.
const invalidAvailableMetrics: CampaignPnlMetrics = {
  unrealizedPnl: pnlMetrics.unrealizedPnl,
  rAvailability: 'available',
};

// @ts-expect-error A stale family requires a failed attempt with a failure reason.
const invalidStaleAttempt: CampaignPriceFamily = {
  family: 'campaign_price',
  status: 'stale',
  attempt: successfulAttempt,
  success: provenance,
  metrics: priceMetrics,
};

// @ts-expect-error Failed families cannot expose metrics.
const invalidFailedMetrics: CampaignPriceFamily = {
  family: 'campaign_price',
  status: 'failed',
  attempt: failedAttempt,
  metrics: priceMetrics,
};

// @ts-expect-error Unsupported families cannot expose metrics.
const invalidUnsupportedMetrics: CampaignPnlFamily = {
  family: 'campaign_unrealized_pnl',
  status: 'unsupported',
  attempt: failedAttempt,
  metrics: pnlMetrics,
};

// @ts-expect-error Unsupported campaign price cannot expose price metrics.
const invalidUnsupportedPrice: CampaignPriceFamily = {
  family: 'campaign_price',
  status: 'unsupported',
  attempt: failedAttempt,
  metrics: priceMetrics,
};

void stalePrice;
void invalidCampaignStatus;
void invalidCampaignR;
void portfolioWithMark;
void invalidAvailableMetrics;
void invalidStaleAttempt;
void invalidFailedMetrics;
void invalidUnsupportedMetrics;
void invalidUnsupportedPrice;
