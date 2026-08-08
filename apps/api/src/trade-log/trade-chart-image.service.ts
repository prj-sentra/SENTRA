import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TradeChartImage } from '@trading-journal/shared';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { OutputInfo } from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

const sharp: typeof import('sharp').default = require('sharp');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1920;
const OUTPUT_MIME_TYPE = 'image/webp';

@Injectable()
export class TradeChartImageService {
  private readonly logger = new Logger(TradeChartImageService.name);
  private readonly storagePath = process.env.TRADE_CHART_IMAGE_PATH?.trim() || '/data/trade-chart-images';

  constructor(private readonly prisma: PrismaService) {}

  async upload(tradeId: string, file: Express.Multer.File | undefined): Promise<TradeChartImage> {
    if (!file) {
      throw new BadRequestException('Chart image file is required');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Chart image must be 10 MB or smaller');
    }

    await this.assertTradeExists(tradeId);

    let output: Buffer;
    let info: OutputInfo;
    try {
      ({ data: output, info } = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88, effort: 4 })
        .toBuffer({ resolveWithObject: true }));
    } catch (error) {
      this.logger.warn(`Chart image conversion failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new BadRequestException('Only valid PNG, JPEG, or WebP chart images are supported');
    }

    await mkdir(this.storagePath, { recursive: true });
    const version = randomUUID();
    const fileName = `${tradeId}.${version}.webp`;
    const finalPath = join(this.storagePath, fileName);
    const temporaryPath = join(this.storagePath, `.${tradeId}.${version}.tmp`);
    const previous = await this.prisma.tradeChartImage.findUnique({ where: { tradeId } });
    await writeFile(temporaryPath, output, { flag: 'wx' });

    try {
      await rename(temporaryPath, finalPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }

    try {
      const image = await this.prisma.tradeChartImage.upsert({
        where: { tradeId },
        create: {
          tradeId,
          fileName,
          mimeType: OUTPUT_MIME_TYPE,
          byteSize: output.byteLength,
          width: info.width,
          height: info.height,
          originalName: file.originalname || null,
        },
        update: {
          fileName,
          mimeType: OUTPUT_MIME_TYPE,
          byteSize: output.byteLength,
          width: info.width,
          height: info.height,
          originalName: file.originalname || null,
        },
      });
      if (previous && basename(previous.fileName) === previous.fileName && previous.fileName !== fileName) {
        await rm(join(this.storagePath, previous.fileName), { force: true }).catch((error) => {
          this.logger.warn(`Old chart image cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      return this.toResponse(image);
    } catch (error) {
      this.logger.warn(`Chart metadata persistence failed; retained immutable file ${fileName} for reconciliation`);
      throw error;
    }
  }

  async get(tradeId: string): Promise<{ buffer: Buffer; mimeType: string; updatedAt: Date }> {
    const image = await this.prisma.tradeChartImage.findUnique({ where: { tradeId } });
    if (!image) {
      throw new NotFoundException(`Chart image not found for trade: ${tradeId}`);
    }
    if (basename(image.fileName) !== image.fileName) {
      throw new NotFoundException(`Chart image not found for trade: ${tradeId}`);
    }

    try {
      return {
        buffer: await readFile(join(this.storagePath, image.fileName)),
        mimeType: image.mimeType,
        updatedAt: image.updatedAt,
      };
    } catch {
      throw new NotFoundException(`Chart image file not found for trade: ${tradeId}`);
    }
  }

  async remove(tradeId: string): Promise<void> {
    const image = await this.prisma.tradeChartImage.findUnique({ where: { tradeId } });
    if (!image) {
      throw new NotFoundException(`Chart image not found for trade: ${tradeId}`);
    }

    await this.prisma.tradeChartImage.delete({ where: { tradeId } });
    if (basename(image.fileName) === image.fileName) {
      await rm(join(this.storagePath, image.fileName), { force: true });
    }
  }

  private async assertTradeExists(tradeId: string): Promise<void> {
    const trade = await this.prisma.trade.findUnique({ where: { id: tradeId }, select: { id: true } });
    if (!trade) {
      throw new NotFoundException(`Trade not found: ${tradeId}`);
    }
  }

  private toResponse(image: {
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    originalName: string | null;
    updatedAt: Date;
  }): TradeChartImage {
    return {
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      originalName: image.originalName ?? undefined,
      updatedAt: image.updatedAt.toISOString(),
    };
  }
}
