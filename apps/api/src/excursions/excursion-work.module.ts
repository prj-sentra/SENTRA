import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EXCURSION_WORK_PRODUCER, EXCURSION_WORKER_WAKE } from '../mt5-accounts/mt5-sync.service';
import { CredentialCipherService } from '../mt5-accounts/credential-cipher.service';
import { Mt5BridgeClient } from '../mt5-accounts/mt5-bridge.client';
import { Mt5BridgeActivityService } from '../mt5-accounts/mt5-bridge-activity.service';
import { EXCURSION_WORKER_PORT } from './excursion-worker.service';
import { ExcursionPrismaAdapter } from './excursion-prisma.adapter';
import { ExcursionWorkerService } from './excursion-worker.service';
import { EXCURSION_CALCULATION_VERSION, ExcursionWorkService } from './excursion-work.service';

@Module({
  providers: [
    ExcursionWorkService,
    ExcursionWorkerService,
    Mt5BridgeClient,
    Mt5BridgeActivityService,
    CredentialCipherService,
    ExcursionPrismaAdapter,
    { provide: EXCURSION_WORKER_PORT, useExisting: ExcursionPrismaAdapter },
    {
      provide: EXCURSION_WORK_PRODUCER,
      useFactory: () => ({
        dirtyTargets: async (tx: any, accountId: string, _snapshot: bigint, targets: any[], reason: string) => {
          for (const target of targets) {
            const current = await tx.excursionWorkItem.findUnique({ where: { scope_targetId: { scope: target.scope, targetId: target.targetId } } });
            const drifted = !current
              || current.generation !== target.generation
              || current.baseInputFingerprint !== target.baseInputFingerprint
              || current.tickSnapshotToMsc !== target.tickSnapshotToMsc;
            if (current && drifted) {
              await tx.excursionWorkProgress.deleteMany({ where: { workItemId: current.id } });
              const attempted = {
                status: 'STALE',
                attemptCalculationVersion: EXCURSION_CALCULATION_VERSION,
                attemptInputFingerprint: target.baseInputFingerprint,
                lastAttemptedAt: new Date(),
                failureReason: reason,
              };
              if (target.scope === 'TRADE') {
                await tx.tradeExcursionResult.updateMany({
                  where: { tradeId: target.targetId, successCalculationVersion: { not: null } },
                  data: attempted,
                });
              } else {
                await tx.tradeCampaignExcursionResult.updateMany({
                  where: { campaignId: target.targetId, successCalculationVersion: { not: null } },
                  data: attempted,
                });
                await tx.tradeCampaignExcursionResult.updateMany({
                  where: { campaignId: target.targetId, priceFamilyStatus: { in: ['SUCCESS', 'STALE'] } },
                  data: { priceFamilyStatus: 'STALE', priceFamilyReason: reason },
                });
                await tx.tradeCampaignExcursionResult.updateMany({
                  where: { campaignId: target.targetId, pnlFamilyStatus: { in: ['SUCCESS', 'STALE'] } },
                  data: { pnlFamilyStatus: 'STALE', pnlFamilyReason: reason },
                });
              }
            }
            await tx.excursionWorkItem.upsert({
              where: { scope_targetId: { scope: target.scope, targetId: target.targetId } },
              create: {
                id: randomUUID(), accountId, scope: target.scope, targetId: target.targetId,
                tradeId: target.scope === 'TRADE' ? target.targetId : null,
                campaignId: target.scope === 'CAMPAIGN' ? target.targetId : null,
                generation: target.generation, baseInputFingerprint: target.baseInputFingerprint,
                tickSnapshotToMsc: target.tickSnapshotToMsc, state: 'PENDING', reason,
              },
              update: {
                generation: target.generation, baseInputFingerprint: target.baseInputFingerprint,
                tickSnapshotToMsc: target.tickSnapshotToMsc, state: 'PENDING', reason,
                claimId: null, claimExpiresAt: null, notBefore: null,
                ...(drifted && { attemptCount: 0, consecutiveFailures: 0, manualRetryEpoch: 0 }),
              },
            });
          }
          return { queued: targets.length };
        },
      }),
    },
    { provide: EXCURSION_WORKER_WAKE, useExisting: ExcursionWorkerService },
  ],
  exports: [ExcursionWorkService, ExcursionWorkerService, EXCURSION_WORK_PRODUCER, EXCURSION_WORKER_WAKE],
})
export class ExcursionWorkModule {}
