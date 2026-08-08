import type { TradeCampaignImage } from '@trading-journal/shared';

export function moveGalleryImage(images: TradeCampaignImage[], imageId: string, offset: -1 | 1): TradeCampaignImage[] {
  const from = images.findIndex((image) => image.id === imageId);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= images.length) return images;
  const ordered = [...images];
  const [image] = ordered.splice(from, 1);
  ordered.splice(to, 0, image);
  return ordered.map((item, position) => ({ ...item, position }));
}
