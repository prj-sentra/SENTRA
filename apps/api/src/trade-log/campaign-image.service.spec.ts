import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
jest.mock('sharp', () => jest.fn((buffer: Buffer) => ({
  rotate: () => ({
    metadata: async () => ({ width: 1, height: 1, format: 'png' }),
    webp: () => ({ toBuffer: async () => ({ data: Buffer.from(buffer), info: { width: 1, height: 1 } }) }),
  }),
})));
import { CampaignImageService } from './campaign-image.service';

const imageRow = {
  id: 'image-1', campaignId: 'campaign-1', position: 0, fileName: '00000000-0000-4000-8000-000000000001.webp',
  mimeType: 'image/webp', byteSize: 10, width: 10, height: 10, originalName: null,
  createdAt: new Date('2026-08-08T00:00:00Z'), updatedAt: new Date('2026-08-08T00:00:00Z'),
};

function prismaMock() {
  const prisma: any = {
    tradeCampaign: { findFirst: jest.fn() },
    tradeCampaignImage: { findMany: jest.fn(), findFirst: jest.fn() },
    mt5Account: { findFirst: jest.fn() },
  };
  return prisma;
}
function uploadPrisma() {
  const rows: any[] = [];
  let nextId = 1;
  let transaction = Promise.resolve();
  const findFirst = jest.fn(async ({ where }: any) => rows.find((row) => Object.entries(where).every(([key, value]) => {
    if (key === 'publishedAt') return value && typeof value === 'object' && 'not' in value ? row.publishedAt !== null : row.publishedAt === value;
    if (key === 'campaign') return true;
    return row[key] === value;
  })) ?? null);
  const image = {
    findFirst,
    count: jest.fn(async ({ where }: any) => rows.filter((row) => row.campaignId === where.campaignId).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `image-${nextId++}`, ...data, createdAt: new Date(), updatedAt: new Date(), publishedAt: null };
      rows.push(row);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((candidate) => candidate.id === where.id && (where.publishedAt !== null || candidate.publishedAt === null));
      if (!row) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error('missing image');
      return row;
    }),
    delete: jest.fn(async ({ where }: any) => {
      const index = rows.findIndex((row) => row.id === where.id);
      if (index >= 0) rows.splice(index, 1);
    }),
  };
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]), $executeRaw: jest.fn(), tradeCampaignImage: image };
  return {
    tradeCampaign: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'campaign-1' && where.ownerId === 'owner-a' && where.mt5AccountId === 'account-a') || (where.id === 'campaign-2' && where.ownerId === 'owner-b' && where.mt5AccountId === 'account-b') ? { id: where.id } : null) },
    tradeCampaignImage: image,
    $transaction: jest.fn((callback: any) => {
      const result = transaction.then(() => callback(tx));
      transaction = result.catch(() => undefined);
      return result;
    }),
    rows,
  };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+WwG5NwAAAABJRU5ErkJggg==', 'base64');
const uploadFile = (contents = png) => ({ buffer: contents, mimetype: 'image/png', originalname: 'chart.png' } as Express.Multer.File);

describe('CampaignImageService ownership and ordering', () => {
  it('does not reveal a foreign campaign', async () => {
    const prisma = prismaMock();
    prisma.tradeCampaign.findFirst.mockResolvedValue(null);
    await expect(new CampaignImageService(prisma).list('owner-a', 'account-a', 'campaign-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tradeCampaign.findFirst).toHaveBeenCalledWith({ where: { id: 'campaign-b', ownerId: 'owner-a', mt5AccountId: 'account-a' }, select: { id: true } });
  });

  it('requires an exact complete unique reorder list', async () => {
    const prisma = prismaMock();
    prisma.tradeCampaign.findFirst.mockResolvedValue({ id: 'campaign-1' });
    prisma.$transaction = jest.fn(async (callback: any) => callback({
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'campaign-1' }]),
      tradeCampaignImage: { findMany: jest.fn().mockResolvedValue([imageRow]) },
    }));
    await expect(new CampaignImageService(prisma).reorder('owner-a', 'account-a', 'campaign-1', ['image-1', 'image-1'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(new CampaignImageService(prisma).reorder('owner-a', 'account-a', 'campaign-1', [])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('locks the campaign and reorders with one database statement', async () => {
    const prisma = prismaMock();
    prisma.tradeCampaign.findFirst.mockResolvedValue({ id: 'campaign-1' });
    prisma.tradeCampaignImage.findMany.mockResolvedValue([{ ...imageRow, position: 0 }]);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'campaign-1' }]),
      $executeRaw: jest.fn(),
      tradeCampaignImage: { findMany: jest.fn().mockResolvedValue([imageRow]) },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(tx));

    await new CampaignImageService(prisma).reorder('owner-a', 'account-a', 'campaign-1', ['image-1']);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('locks ownership, re-reads the image, and reindexes deletion in the same transaction', async () => {
    const prisma = prismaMock();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'campaign-1' }]),
      $executeRaw: jest.fn(),
      tradeCampaignImage: {
        findFirst: jest.fn().mockResolvedValue(imageRow),
        delete: jest.fn(),
      },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(tx));

    await new CampaignImageService(prisma).remove('owner-a', 'account-a', 'campaign-1', 'image-1');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.tradeCampaignImage.findFirst).toHaveBeenCalledWith({ where: { id: 'image-1', campaignId: 'campaign-1' } });
    expect(tx.tradeCampaignImage.delete).toHaveBeenCalledWith({ where: { id: 'image-1' } });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.tradeCampaignImage.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a delete when campaign ownership fails under the lock', async () => {
    const prisma = prismaMock();
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    prisma.$transaction = jest.fn(async (callback: any) => callback(tx));

    await expect(new CampaignImageService(prisma).remove('owner-a', 'account-a', 'campaign-1', 'image-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('scopes image lookup through campaign ownership', async () => {
    const prisma = prismaMock();
    prisma.tradeCampaignImage.findFirst.mockResolvedValue(null);
    await expect(new CampaignImageService(prisma).get('owner-a', 'account-a', 'campaign-1', 'image-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tradeCampaignImage.findFirst).toHaveBeenCalledWith({ where: { id: 'image-1', campaignId: 'campaign-1', publishedAt: { not: null }, campaign: { ownerId: 'owner-a', mt5AccountId: 'account-a' } } });
  });

  it('reads an owned image from the configured filesystem root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'campaign-images-'));
    const previousRoot = process.env.TRADE_IMAGE_DIR;
    process.env.TRADE_IMAGE_DIR = root;
    try {
      const prisma = prismaMock();
      prisma.tradeCampaignImage.findFirst.mockResolvedValue(imageRow);
      await writeFile(join(root, imageRow.fileName), Buffer.from('verified-image'));
      const result = await new CampaignImageService(prisma).get('owner-a', 'account-a', 'campaign-1', 'image-1');
      expect(result.buffer.toString()).toBe('verified-image');
      expect(result.record).not.toHaveProperty('fileName');
    } finally {
      if (previousRoot === undefined) delete process.env.TRADE_IMAGE_DIR;
      else process.env.TRADE_IMAGE_DIR = previousRoot;
      await rm(root, { recursive: true, force: true });
    }
  });
  it('publishes a renamed crash-window image and transactionally compacts a stale unpublished claim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'campaign-images-'));
    const previousRoot = process.env.TRADE_IMAGE_DIR;
    process.env.TRADE_IMAGE_DIR = root;
    try {
      const prisma = prismaMock();
      const publishedCandidate = { ...imageRow, id: 'image-published', publishedAt: null };
      const staleCandidate = { ...imageRow, id: 'image-stale', position: 1, fileName: '00000000-0000-4000-8000-000000000002.webp', publishedAt: null };
      prisma.tradeCampaignImage.findMany.mockResolvedValue([publishedCandidate, staleCandidate]);
      prisma.tradeCampaignImage.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'campaign-1' }]),
        $executeRaw: jest.fn(),
        tradeCampaignImage: {
          findFirst: jest.fn().mockResolvedValue(staleCandidate),
          delete: jest.fn(),
        },
      };
      prisma.$transaction = jest.fn(async (callback: any) => callback(tx));
      await writeFile(join(root, publishedCandidate.fileName), Buffer.from('published-after-crash'));

      await new CampaignImageService(prisma).onModuleInit();

      expect(prisma.tradeCampaignImage.updateMany).toHaveBeenCalledWith({ where: { id: 'image-published', publishedAt: null }, data: { publishedAt: expect.any(Date) } });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.tradeCampaignImage.findFirst).toHaveBeenCalledWith({ where: { id: 'image-stale', campaignId: 'campaign-1', publishedAt: null, createdAt: { lte: expect.any(Date) } } });
      expect(tx.tradeCampaignImage.delete).toHaveBeenCalledWith({ where: { id: 'image-stale' } });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    } finally {
      if (previousRoot === undefined) delete process.env.TRADE_IMAGE_DIR;
      else process.env.TRADE_IMAGE_DIR = previousRoot;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never includes an unpublished image in a gallery response', async () => {
    const prisma = prismaMock();
    prisma.tradeCampaign.findFirst.mockResolvedValue({ id: 'campaign-1' });
    prisma.tradeCampaignImage.findMany.mockResolvedValue([]);

    await new CampaignImageService(prisma).list('owner-a', 'account-a', 'campaign-1');

    expect(prisma.tradeCampaignImage.findMany).toHaveBeenCalledWith({ where: { campaignId: 'campaign-1', publishedAt: { not: null } }, orderBy: { position: 'asc' } });
  });
  it('isolates concurrent replay IDs by campaign and preserves independent files through cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'campaign-images-'));
    const previousRoot = process.env.TRADE_IMAGE_DIR;
    process.env.TRADE_IMAGE_DIR = root;
    try {
      const prisma = uploadPrisma();
      const service = new CampaignImageService(prisma as any);
      const replayId = '00000000-0000-4000-8000-000000000099';
      const [first, replay, second] = await Promise.all([
        service.upload('owner-a', 'account-a', 'campaign-1', replayId, uploadFile()),
        service.upload('owner-a', 'account-a', 'campaign-1', replayId, uploadFile()),
        service.upload('owner-b', 'account-b', 'campaign-2', replayId, uploadFile(Buffer.concat([png, Buffer.from('campaign-two')]))),
      ]);

      expect(first.id).toBe(replay.id);
      expect(first.campaignId).toBe('campaign-1');
      expect(second.campaignId).toBe('campaign-2');
      expect(prisma.rows).toHaveLength(2);
      expect(new Set(prisma.rows.map((row: any) => row.fileName)).size).toBe(2);
      expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
      expect((await service.get('owner-a', 'account-a', 'campaign-1', first.id)).buffer.byteLength).toBeGreaterThan(0);
      expect((await service.get('owner-b', 'account-b', 'campaign-2', second.id)).buffer.byteLength).toBeGreaterThan(0);

      await service.remove('owner-a', 'account-a', 'campaign-1', first.id);

      await expect(service.get('owner-a', 'account-a', 'campaign-1', first.id)).rejects.toBeInstanceOf(NotFoundException);
      expect((await service.get('owner-b', 'account-b', 'campaign-2', second.id)).buffer.byteLength).toBeGreaterThan(0);
    } finally {
      if (previousRoot === undefined) delete process.env.TRADE_IMAGE_DIR;
      else process.env.TRADE_IMAGE_DIR = previousRoot;
      await rm(root, { recursive: true, force: true });
    }
  });
});
