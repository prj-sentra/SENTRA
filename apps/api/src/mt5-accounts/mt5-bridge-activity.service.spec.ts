import { Mt5BridgeActivityService } from './mt5-bridge-activity.service';

function database() {
  const rows: any[] = [];
  const model = {
    deleteMany: jest.fn(async ({ where }: any) => {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index];
        const kindMatches = !where.kind || (where.kind.in ? where.kind.in.includes(row.kind) : row.kind === where.kind);
        const leaseMatches = !where.leaseId || row.leaseId === where.leaseId;
        const idMatches = !where.id || row.id === where.id;
        const expired = !where.expiresAt?.lte || row.expiresAt <= where.expiresAt.lte;
        if (kindMatches && leaseMatches && idMatches && expired) rows.splice(index, 1);
      }
      return { count: before - rows.length };
    }),
    create: jest.fn(async ({ data }: any) => { rows.push({ ...data }); return data; }),
    findFirst: jest.fn(async ({ where }: any) => rows.find((row) => where.kind?.in ? where.kind.in.includes(row.kind) : row.kind === where.kind) ?? null),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const matches = rows.filter((row) => row.kind === where.kind && row.leaseId === where.leaseId);
      matches.forEach((row) => Object.assign(row, data));
      return { count: matches.length };
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const row = rows.find((entry) => entry.id === where.id);
      if (row) { Object.assign(row, update); return row; }
      rows.push({ ...create }); return create;
    }),
  };
  const db: any = {
    mt5BridgeActivity: model,
    $queryRaw: jest.fn().mockResolvedValue([{ locked: '1' }]),
    $transaction: jest.fn(async (callback: any) => callback(db)),
  };
  return { db, rows };
}

describe('Mt5BridgeActivityService', () => {
  it('registers sync intent under the shared advisory lock and denies a worker slot', async () => {
    const { db, rows } = database();
    const service = new Mt5BridgeActivityService(db);
    const syncLease = await service.registerSyncIntent('account-1');
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'SYNC', accountId: 'account-1', leaseId: syncLease })]));
    await expect(service.acquireWorkerLease(45_000)).resolves.toBeNull();
  });

  it('holds one global worker slot and releases only the matching lease', async () => {
    const { db, rows } = database();
    const service = new Mt5BridgeActivityService(db);
    const lease = await service.acquireWorkerLease(45_000);
    expect(lease).toEqual(expect.any(String));
    expect(rows).toEqual([expect.objectContaining({ id: 'worker', kind: 'WORKER', leaseId: lease })]);
    await expect(service.acquireWorkerLease(45_000)).resolves.toBeNull();
    await service.releaseWorkerLease('wrong');
    expect(rows).toHaveLength(1);
    await service.releaseWorkerLease(lease!);
    expect(rows).toHaveLength(0);
  });

  it('persists a fail-closed halt that blocks future worker leases', async () => {
    const { db, rows } = database();
    const service = new Mt5BridgeActivityService(db);
    await service.haltWorker('TICK_INVALID_PAYLOAD');
    expect(rows).toEqual([expect.objectContaining({ kind: 'HALT', reason: 'TICK_INVALID_PAYLOAD' })]);
    await expect(service.acquireWorkerLease(45_000)).resolves.toBeNull();
  });
});
