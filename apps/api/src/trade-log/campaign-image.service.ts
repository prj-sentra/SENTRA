import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type sharpType from 'sharp';
import { lockOwnedMt5Account } from '../mt5-accounts/mt5-account-lock';
import { PrismaService } from '../prisma/prisma.service';
const sharp: typeof sharpType = require('sharp');

const MAX_IMAGES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const RECOVERY_GRACE_MS = 60_000;

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
export class CampaignImageService implements OnModuleInit {
  private readonly root = resolve(process.env.TRADE_IMAGE_DIR?.trim() || '/data/trade-images');

  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit(): Promise<void> {
    await this.reconcileUnpublished();
  }

  async list(ownerId: string, accountId: string | undefined, campaignId: string): Promise<CampaignImageRecord[]> {
    await this.requireCampaign(ownerId, accountId, campaignId);
    const rows = await this.prisma.tradeCampaignImage.findMany({ where: { campaignId, publishedAt: { not: null } }, orderBy: { position: 'asc' } });
    return rows.map((row) => this.serialize(row));
  }

  async upload(ownerId: string, accountId: string | undefined, campaignId: string, uploadId?: string, file?: Express.Multer.File): Promise<CampaignImageRecord> {
    await this.requireCampaign(ownerId, accountId, campaignId);
    if (!uploadId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(uploadId)) throw new BadRequestException('uploadId UUID required');
    const replay = await this.awaitPublication(campaignId, uploadId);
    if (replay) return this.serialize(replay);
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
    let row: Awaited<ReturnType<typeof this.prisma.tradeCampaignImage.create>> | undefined;
    let finalCreated = false;
    try {
      await writeFile(temporaryPath, output.data, { flag: 'wx' });
      row = await this.prisma.$transaction(async (tx) => {
        if (!accountId) throw new BadRequestException('accountId is required');
        await lockOwnedMt5Account(tx, ownerId, accountId);
        const campaigns = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "trade_campaigns" WHERE "id" = ${campaignId} FOR UPDATE
        `;
        if (campaigns.length !== 1) throw new NotFoundException(`Campaign ${campaignId} not found`);
        const existing = await tx.tradeCampaignImage.findFirst({ where: { campaignId, uploadId } });
        if (existing) return existing;
        const count = await tx.tradeCampaignImage.count({ where: { campaignId } });
        if (count >= MAX_IMAGES) throw new BadRequestException('Campaign gallery is limited to 10 images');
        return tx.tradeCampaignImage.create({ data: { campaignId, uploadId, position: count, fileName, mimeType: 'image/webp', byteSize: output.data.byteLength, contentSha256: createHash('sha256').update(output.data).digest('hex'), width: output.info.width, height: output.info.height, originalName: file.originalname || null } });
      });
      if (row.fileName !== fileName) {
        const published = await this.awaitPublication(campaignId, uploadId);
        if (published) return this.serialize(published);
        throw new ConflictException('Image upload is still being published');
      }
      await link(temporaryPath, finalPath);
      finalCreated = true;
      const published = await this.prisma.tradeCampaignImage.updateMany({ where: { id: row.id, publishedAt: null }, data: { publishedAt: new Date() } });
      if (published.count !== 1) {
        const replay = await this.awaitPublication(campaignId, uploadId);
        if (replay) return this.serialize(replay);
        throw new ConflictException('Image upload could not be published');
      }
      row = await this.prisma.tradeCampaignImage.findUniqueOrThrow({ where: { id: row.id } });
      return this.serialize(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.awaitPublication(campaignId, uploadId);
        if (replay) return this.serialize(replay);
        throw new ConflictException('Image upload is still being published');
      }
      if (finalCreated && row?.fileName === fileName) {
        await unlink(finalPath).catch(() => undefined);
        await this.prisma.tradeCampaignImage.delete({ where: { id: row.id } }).catch(() => undefined);
      }
      throw error;
    } finally {
      await this.removeTemporary(temporaryName);
    }
  }

  async get(ownerId: string, accountId: string | undefined, campaignId: string, imageId: string): Promise<{ record: CampaignImageRecord; buffer: Buffer }> {
    if (!accountId) throw new BadRequestException('accountId is required');
    const row = await this.findOwned(ownerId, accountId, campaignId, imageId);
    try {
      return { record: this.serialize(row), buffer: await readFile(this.safePath(row.fileName)) };
    } catch {
      throw new NotFoundException('Campaign image file not found');
    }
  }

  async reorder(ownerId: string, accountId: string | undefined, campaignId: string, imageIds: string[]): Promise<CampaignImageRecord[]> {
    if (!accountId) throw new BadRequestException('accountId is required');
    if (!Array.isArray(imageIds) || new Set(imageIds).size !== imageIds.length) throw new BadRequestException('imageIds must be unique');
    const rows = await this.prisma.$transaction(async (tx) => {
      await this.lockOwnedCampaign(tx, ownerId, accountId, campaignId);
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

  async remove(ownerId: string, accountId: string | undefined, campaignId: string, imageId: string): Promise<void> {
    const fileName = await this.prisma.$transaction(async (tx) => {
      if (!accountId) throw new BadRequestException('accountId is required');
      await this.lockOwnedCampaign(tx, ownerId, accountId, campaignId);
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

  private async requireCampaign(ownerId: string, accountId: string | undefined, campaignId: string): Promise<void> {
    if (!accountId) throw new BadRequestException('accountId is required');
    const campaign = await this.prisma.tradeCampaign.findFirst({ where: { id: campaignId, ownerId, mt5AccountId: accountId }, select: { id: true } });
    if (!campaign) throw new NotFoundException(`Campaign ${campaignId} not found`);
  }

  private async findOwned(ownerId: string, accountId: string, campaignId: string, imageId: string) {
    const row = await this.prisma.tradeCampaignImage.findFirst({ where: { id: imageId, campaignId, publishedAt: { not: null }, campaign: { ownerId, mt5AccountId: accountId } } });
    if (!row) throw new NotFoundException(`Campaign image ${imageId} not found`);
    return row;
  }

  private async awaitPublication(campaignId: string, uploadId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const row = await this.prisma.tradeCampaignImage.findFirst({ where: { campaignId, uploadId } });
      if (!row) return undefined;
      if (row.publishedAt) return row;
      if (await this.fileExists(row.fileName)) {
        await this.prisma.tradeCampaignImage.updateMany({ where: { id: row.id, publishedAt: null }, data: { publishedAt: new Date() } });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
  }

  private async reconcileUnpublished(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const cutoff = new Date(Date.now() - RECOVERY_GRACE_MS);
    const rows = await this.prisma.tradeCampaignImage.findMany({ where: { publishedAt: null } });
    for (const row of rows) {
      if (await this.fileExists(row.fileName)) {
        await this.prisma.tradeCampaignImage.updateMany({ where: { id: row.id, publishedAt: null }, data: { publishedAt: new Date() } });
      } else if (row.createdAt <= cutoff) {
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw(Prisma.sql`
            SELECT "id" FROM "trade_campaigns" WHERE "id" = ${row.campaignId} FOR UPDATE
          `);
          const stale = await tx.tradeCampaignImage.findFirst({
            where: { id: row.id, campaignId: row.campaignId, publishedAt: null, createdAt: { lte: cutoff } },
          });
          if (!stale) return;
          await tx.tradeCampaignImage.delete({ where: { id: stale.id } });
          await tx.$executeRaw(Prisma.sql`
            UPDATE "trade_campaign_images"
            SET "position" = "position" - 1,
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "campaign_id" = ${row.campaignId}
              AND "position" > ${stale.position}
          `);
        });
      }
    }
    const names = await readdir(this.root);
    await Promise.all(names.filter((name) => /^\.[0-9a-f-]+\.webp\.tmp$/i.test(name)).map(async (name) => {
      try {
        const temporaryPath = this.safePath(name);
        const file = await stat(temporaryPath);
        if (file.mtime <= cutoff) await this.removeTemporary(name);
      } catch {
        // Another instance may have completed or removed the temporary file.
      }
    }));
  }

  private async fileExists(fileName: string): Promise<boolean> {
    try {
      await readFile(this.safePath(fileName));
      return true;
    } catch {
      return false;
    }
  }
  private async removeTemporary(fileName: string): Promise<void> {
    await unlink(this.safePath(fileName)).catch(() => undefined);
  }
  private async lockOwnedCampaign(tx: Prisma.TransactionClient, ownerId: string, accountId: string, campaignId: string): Promise<void> {
    await lockOwnedMt5Account(tx, ownerId, accountId);
    const campaigns = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "trade_campaigns"
      WHERE "id" = ${campaignId} AND "owner_id" = ${ownerId} AND "mt5_account_id" = ${accountId}
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
