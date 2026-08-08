import { useMemo, useState, type ChangeEvent, type DragEvent } from 'react';
import type { TradeCampaignImage } from '@trading-journal/shared';
import { ImageLightbox } from './ImageLightbox';
import { moveGalleryImage } from './gallery-order';

export interface TradeImageGalleryProps {
  campaignId: string;
  symbol: string;
  images: TradeCampaignImage[];
  imageUrl: (campaignId: string, imageId: string) => string;
  onUpload: (campaignId: string, file: File) => Promise<void>;
  onReorder: (campaignId: string, imageIds: string[]) => Promise<void>;
  onDelete: (campaignId: string, imageId: string) => Promise<void>;
}

export function TradeImageGallery({ campaignId, symbol, images, imageUrl, onUpload, onReorder, onDelete }: TradeImageGalleryProps) {
  const ordered = useMemo(() => [...images].sort((a, b) => a.position - b.position), [images]);
  const [preview, setPreview] = useState<TradeCampaignImage | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || images.length >= 10) return;
    setBusy(true);
    try { await onUpload(campaignId, file); } finally { setBusy(false); }
  }

  async function move(imageId: string, offset: -1 | 1) {
    const next = moveGalleryImage(ordered, imageId, offset);
    if (next === ordered) return;
    setBusy(true);
    try { await onReorder(campaignId, next.map((image) => image.id)); } finally { setBusy(false); }
  }

  async function drop(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    const ids = ordered.map((image) => image.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDraggedId(null);
    setBusy(true);
    try { await onReorder(campaignId, ids); } finally { setBusy(false); }
  }

  return (
    <section className="trade-gallery" aria-label={`${symbol} trade images`}>
      <div className="gallery-heading"><strong>Images</strong><span>{images.length}/10</span></div>
      <ul className="gallery-grid">
        {ordered.map((image, index) => {
          const src = imageUrl(campaignId, image.id);
          const alt = `${symbol} trade chart ${index + 1}`;
          return <li key={image.id} draggable={!busy} onDragStart={() => setDraggedId(image.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void drop(event, image.id)}>
            <button className="gallery-preview" type="button" onClick={() => setPreview(image)}><img src={src} alt={alt} /></button>
            <div className="gallery-actions">
              <button type="button" disabled={busy || index === 0} onClick={() => void move(image.id, -1)} aria-label={`Move image ${index + 1} left`}>←</button>
              <button type="button" disabled={busy || index === ordered.length - 1} onClick={() => void move(image.id, 1)} aria-label={`Move image ${index + 1} right`}>→</button>
              <button type="button" disabled={busy} onClick={() => void onDelete(campaignId, image.id)} aria-label={`Delete image ${index + 1}`}>Delete</button>
            </div>
          </li>;
        })}
      </ul>
      <label className="gallery-upload"><span>{busy ? 'Working…' : images.length >= 10 ? 'Maximum 10 images' : 'Add image'}</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || images.length >= 10} onChange={(event) => void upload(event)} /></label>
      {preview ? <ImageLightbox src={imageUrl(campaignId, preview.id)} alt={`${symbol} trade chart preview`} onClose={() => setPreview(null)} /> : null}
    </section>
  );
}
