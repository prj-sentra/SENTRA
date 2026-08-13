import { ExcursionPrismaAdapter } from './excursion-prisma.adapter';

describe('ExcursionPrismaAdapter checkpoints', () => {
  it('persists the complete raw range on both checkpoint creation and resume', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const tx = {
      excursionWorkItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      excursionWorkProgress: { upsert },
    };
    const prisma = { $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)) };
    const adapter = new ExcursionPrismaAdapter(prisma as never, {} as never, {} as never);
    const now = new Date('2026-08-13T00:00:00Z');
    const claim = {
      id: 'work-1', generation: 1, baseInputFingerprint: 'fingerprint', tickSnapshotToMsc: 10n,
      claimId: 'claim-1', claimExpiresAt: new Date('2026-08-13T00:01:00Z'),
    };
    const progress = {
      workItemId: 'work-1', generation: 1, rawFromMsc: 100n, rawToMsc: 1_000n, nextRawFromMsc: 401n,
      completedChunkCount: 1, completedPageCount: 2, completedTickCount: 3, checkpointedAt: now,
    };

    await expect(adapter.checkpoint(claim, progress)).resolves.toBe(true);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ rawFromMsc: 100n, rawToMsc: 1_000n, nextRawFromMsc: 401n }),
      update: expect.objectContaining({ rawFromMsc: 100n, rawToMsc: 1_000n, nextRawFromMsc: 401n }),
    }));
  });
});
