import { BadRequestException, NotFoundException } from '@nestjs/common';
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

describe('CampaignImageService ownership and ordering', () => {
  it('does not reveal a foreign campaign', async () => {
    const prisma = prismaMock();
    prisma.tradeCampaign.findFirst.mockResolvedValue(null);
    await expect(new CampaignImageService(prisma).list('owner-a', 'campaign-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tradeCampaign.findFirst).toHaveBeenCalledWith({ where: { id: 'campaign-b', ownerId: 'owner-a' }, select: { id: true } });
  });

  it('requires an exact complete unique reorder list', async () => {
    const prisma = prismaMock();
    prisma.tradeCampaign.findFirst.mockResolvedValue({ id: 'campaign-1' });
    prisma.$transaction = jest.fn(async (callback: any) => callback({
      $queryRaw: jest.fn(),
      tradeCampaignImage: { findMany: jest.fn().mockResolvedValue([imageRow]) },
    }));
    await expect(new CampaignImageService(prisma).reorder('owner-a', 'campaign-1', ['image-1', 'image-1'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(new CampaignImageService(prisma).reorder('owner-a', 'campaign-1', [])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('locks the campaign and reorders with one database statement', async () => {
    const prisma = prismaMock();
    prisma.tradeCampaign.findFirst.mockResolvedValue({ id: 'campaign-1' });
    prisma.tradeCampaignImage.findMany.mockResolvedValue([{ ...imageRow, position: 0 }]);
    const tx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      tradeCampaignImage: { findMany: jest.fn().mockResolvedValue([imageRow]) },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(tx));

    await new CampaignImageService(prisma).reorder('owner-a', 'campaign-1', ['image-1']);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('scopes image lookup through campaign ownership', async () => {
    const prisma = prismaMock();
    prisma.tradeCampaignImage.findFirst.mockResolvedValue(null);
    await expect(new CampaignImageService(prisma).get('owner-a', 'campaign-1', 'image-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tradeCampaignImage.findFirst).toHaveBeenCalledWith({ where: { id: 'image-1', campaignId: 'campaign-1', campaign: { ownerId: 'owner-a' } } });
  });
});
