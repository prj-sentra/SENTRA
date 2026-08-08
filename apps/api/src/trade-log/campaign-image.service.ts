import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

const MAX_IMAGES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface CampaignImageRecord {
  id: string;
  campaignId: string;
  position: number;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  originalName?: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CampaignImageService {
  private readonly root = resolve(process.env.TRADE_IMAGE_DIR?.trim() || '/data/trade-images');

  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string, campaignId: string): Promise<CampaignImageRecord[]> {
    await this.requireCampaign(ownerId, campaignId);
    const rows = await this.prisma.tradeCampaignImage.findMany({ where: { campaignId }, orderBy: { position: 'asc' } });
    return rows.map((row) => this.serialize(row));
  }

  async upload(ownerId: string, campaignId: string, file?: Express.Multer.File): Promise<CampaignImageRecord> {
    await this.requireCampaign(ownerId, campaignId);
    if (!file || !ALLOWED_MIME_TYPES.has(file.mimetype)) throw new BadRequestException('PNG, JPEG, or WebP image required');
    const image = sharp(file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(metadata.format ?? '')) throw new BadRequestException('Invalid image');
    const output = await image.webp({ quality: 90, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (output.data.byteLength > MAX_BYTES) throw new BadRequestException('Encoded image exceeds 10MB');

    await mkdir(this.root, { recursive: true });
    const fileName = `${randomUUID()}.webp`;
    const temporaryName = `.${fileName}.tmp`;
    const temporaryPath = this.safePath(temporaryName);
    const finalPath = this.safePath(fileName);
    await writeFile(temporaryPath, output.data, { flag: 'wx' });
    let row: Awaited<ReturnType<typeof this.prisma.tradeCampaignImage.create>> | undefined;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "trade_campaigns" WHERE "id" = ${campaignId} FOR UPDATE`;
        const count = await tx.tradeCampaignImage.count({ where: { campaignId } });
        if (count >= MAX_IMAGES) throw new BadRequestException('Campaign gallery is limited to 10 images');
        return tx.tradeCampaignImage.create({ data: { campaignId, position: count, fileName, mimeType: 'image/webp', byteSize: output.data.byteLength, contentSha256: createHash('sha256').update(output.data).digest('hex'), width: output.info.width, height: output.info.height, originalName: file.originalname || null } });
      });
      await rename(temporaryPath, finalPath);
      return this.serialize(row);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      if (row) await this.prisma.tradeCampaignImage.delete({ where: { id: row.id } }).catch(() => undefined);
      throw error;
    }
  }

  async get(ownerId: string, campaignId: string, imageId: string): Promise<{ record: CampaignImageRecord; buffer: Buffer }> {
    const row = await this.findOwned(ownerId, campaignId, imageId);
    try {
      return { record: this.serialize(row), buffer: await readFile(this.safePath(row.fileName)) };
    } catch {
      throw new NotFoundException('Campaign image file not found');
    }
  }

  async reorder(ownerId: string, campaignId: string, imageIds: string[]): Promise<CampaignImageRecord[]> {
    if (!Array.isArray(imageIds) || new Set(imageIds).size !== imageIds.length) throw new BadRequestException('imageIds must be unique');
    const rows = await this.prisma.$transaction(async (tx) => {
      await this.lockOwnedCampaign(tx, ownerId, campaignId);
      const lockedRows = await tx.tradeCampaignImage.findMany({ where: { campaignId }, orderBy: { position: 'asc' } });
      if (lockedRows.length !== imageIds.length || lockedRows.some((row) => !imageIds.includes(row.id))) throw new BadRequestException('imageIds must contain the complete campaign gallery');
      if (imageIds.length) {
        const assignments = imageIds.map((id, position) => Prisma.sql`WHEN ${id} THEN ${position}`);
        await tx.$executeRaw(Prisma.sql`
          UPDATE "trade_campaign_images"
          SET "position" = CASE "id" ${Prisma.join(assignments, ' ')} END,
              "updated_at" = CURRENT_TIMESTAMP
          WHERE "campaign_id" = ${campaignId}
        `);
      }
      return tx.tradeCampaignImage.findMany({ where: { campaignId }, orderBy: { position: 'asc' } });
    });
    return rows.map((row) => this.serialize(row));
  }

  async remove(ownerId: string, campaignId: string, imageId: string): Promise<void> {
    const fileName = await this.prisma.$transaction(async (tx) => {
      await this.lockOwnedCampaign(tx, ownerId, campaignId);
      const row = await tx.tradeCampaignImage.findFirst({ where: { id: imageId, campaignId } });
      if (!row) throw new NotFoundException(`Campaign image ${imageId} not found`);
      await tx.tradeCampaignImage.delete({ where: { id: imageId } });
      await tx.$executeRaw(Prisma.sql`
        UPDATE "trade_campaign_images"
        SET "position" = "position" - 1,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "campaign_id" = ${campaignId}
          AND "position" > ${row.position}
      `);
      return row.fileName;
    });
    await unlink(this.safePath(fileName)).catch(() => undefined);
  }

  private async requireCampaign(ownerId: string, campaignId: string): Promise<void> {
    const campaign = await this.prisma.tradeCampaign.findFirst({ where: { id: campaignId, ownerId }, select: { id: true } });
    if (!campaign) throw new NotFoundException(`Campaign ${campaignId} not found`);
  }

  private async findOwned(ownerId: string, campaignId: string, imageId: string) {
    const row = await this.prisma.tradeCampaignImage.findFirst({ where: { id: imageId, campaignId, campaign: { ownerId } } });
    if (!row) throw new NotFoundException(`Campaign image ${imageId} not found`);
    return row;
  }

  private async lockOwnedCampaign(tx: Prisma.TransactionClient, ownerId: string, campaignId: string): Promise<void> {
    const campaigns = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "trade_campaigns"
      WHERE "id" = ${campaignId} AND "owner_id" = ${ownerId}
      FOR UPDATE
    `);
    if (campaigns.length !== 1) throw new NotFoundException(`Campaign ${campaignId} not found`);
  }

  private safePath(fileName: string): string {
    if (!/^\.?[0-9a-f-]+\.webp(?:\.tmp)?$/i.test(fileName)) throw new BadRequestException('Invalid image path');
    const path = resolve(this.root, fileName);
    if (!path.startsWith(`${this.root}${sep}`)) throw new BadRequestException('Invalid image path');
    return path;
  }

  private serialize(row: { id: string; campaignId: string; position: number; mimeType: string; byteSize: number; width: number; height: number; originalName: string | null; createdAt: Date; updatedAt: Date }): CampaignImageRecord {
    return {
      id: row.id,
      campaignId: row.campaignId,
      position: row.position,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      width: row.width,
      height: row.height,
      originalName: row.originalName ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
