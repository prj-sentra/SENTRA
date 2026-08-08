import { NotFoundException } from '@nestjs/common';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { TradeChartImageService } from './trade-chart-image.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(), readFile: jest.fn(), rename: jest.fn(), rm: jest.fn(), writeFile: jest.fn(),
}));
jest.mock('sharp', () => jest.fn());

const sharp = require('sharp') as jest.Mock;
const fs = { mkdir: mkdir as jest.Mock, readFile: readFile as jest.Mock, rename: rename as jest.Mock, rm: rm as jest.Mock, writeFile: writeFile as jest.Mock };
const updatedAt = new Date('2026-08-01T00:00:00.000Z');
const image = { fileName: 'trade-1.webp', mimeType: 'image/webp', byteSize: 9, width: 3, height: 2, originalName: 'chart.png', updatedAt };

function createPrisma(overrides: Record<string, unknown> = {}) {
  return {
    trade: { findUnique: jest.fn().mockResolvedValue({ id: 'trade-1' }) },
    tradeChartImage: { upsert: jest.fn().mockResolvedValue(image), findUnique: jest.fn().mockResolvedValue(image), delete: jest.fn().mockResolvedValue(image) },
    ...overrides,
  } as any;
}

describe('TradeChartImageService', () => {
  const storagePath = '/tmp/trade-chart-image-spec';

  beforeEach(() => {
    process.env.TRADE_CHART_IMAGE_PATH = storagePath;
    jest.clearAllMocks();
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.rename.mockResolvedValue(undefined);
    fs.rm.mockResolvedValue(undefined);
    sharp.mockReturnValue({ rotate: () => ({ resize: () => ({ webp: () => ({ toBuffer: jest.fn().mockResolvedValue({ data: Buffer.from('webp-data'), info: { width: 3, height: 2 } }) }) }) }) });
  });

  it('converts, persists, retrieves, and removes a chart image through its file lifecycle', async () => {
    const prisma = createPrisma();
    const service = new TradeChartImageService(prisma);
    const file = { size: 8, buffer: Buffer.from('png-data'), originalname: 'chart.png' } as Express.Multer.File;

    await expect(service.upload('trade-1', file)).resolves.toEqual({ mimeType: 'image/webp', byteSize: 9, width: 3, height: 2, originalName: 'chart.png', updatedAt: updatedAt.toISOString() });
    expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('/.trade-1.'), Buffer.from('webp-data'), { flag: 'wx' });
    expect(prisma.tradeChartImage.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ tradeId: 'trade-1', fileName: expect.stringMatching(/^trade-1\..+\.webp$/), mimeType: 'image/webp', byteSize: 9 }) }));
    expect(fs.rename).toHaveBeenCalledWith(expect.stringContaining('/.trade-1.'), expect.stringMatching(new RegExp(`^${storagePath}/trade-1\\..+\\.webp$`)));

    fs.readFile.mockResolvedValue(Buffer.from('stored-webp'));
    await expect(service.get('trade-1')).resolves.toEqual({ buffer: Buffer.from('stored-webp'), mimeType: 'image/webp', updatedAt });
    await expect(service.remove('trade-1')).resolves.toBeUndefined();
    expect(prisma.tradeChartImage.delete).toHaveBeenCalledWith({ where: { tradeId: 'trade-1' } });
    expect(fs.rm).toHaveBeenCalledWith(`${storagePath}/trade-1.webp`, { force: true });
  });

  it('does not publish metadata when the immutable file rename fails', async () => {
    const prisma = createPrisma();
    fs.rename.mockRejectedValueOnce(new Error('rename failed'));
    const service = new TradeChartImageService(prisma);
    const file = { size: 8, buffer: Buffer.from('png-data'), originalname: 'chart.png' } as Express.Multer.File;

    await expect(service.upload('trade-1', file)).rejects.toThrow('rename failed');
    expect(prisma.tradeChartImage.upsert).not.toHaveBeenCalled();
    expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining('/.trade-1.'), { force: true });
  });

  it('retains newly published immutable bytes when metadata persistence outcome is uncertain', async () => {
    const prisma = createPrisma({
      tradeChartImage: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockRejectedValue(new Error('database failed')),
      },
    });
    const service = new TradeChartImageService(prisma);
    const file = { size: 8, buffer: Buffer.from('png-data'), originalname: 'chart.png' } as Express.Multer.File;

    await expect(service.upload('trade-1', file)).rejects.toThrow('database failed');
    expect(fs.rm).not.toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${storagePath}/trade-1\\..+\\.webp$`)), { force: true });
  });

  it('does not read files outside the chart-image directory', async () => {
    const prisma = createPrisma({ tradeChartImage: { findUnique: jest.fn().mockResolvedValue({ ...image, fileName: '../secret.webp' }) } });
    await expect(new TradeChartImageService(prisma).get('trade-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});
