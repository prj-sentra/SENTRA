import { useEffect, useMemo, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react';
import type { TradeCampaignImage } from '@trading-journal/shared';
import { ImageLightbox } from './ImageLightbox';
import { moveGalleryImage } from './gallery-order';

export interface TradeImageGalleryProps {
  campaignId: string;
  symbol: string;
  images: TradeCampaignImage[];
  imageUrl: (campaignId: string, imageId: string) => string;
  onUpload: (campaignId: string, file: File, uploadId: string) => Promise<TradeCampaignImage>;
  onReorder: (campaignId: string, imageIds: string[]) => Promise<void>;
  onDelete: (campaignId: string, imageId: string) => Promise<void>;
}

interface FailedUpload { file: File; uploadId: string; previewUrl: string; message: string; }
const uploadId = (): string => crypto.randomUUID();

export function TradeImageGallery({ campaignId, symbol, images, imageUrl, onUpload, onReorder, onDelete }: TradeImageGalleryProps) {
  const ordered = useMemo(() => [...images].sort((a, b) => a.position - b.position), [images]);
  const [preview, setPreview] = useState<TradeCampaignImage | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedUpload, setFailedUpload] = useState<FailedUpload | null>(null);
  useEffect(() => () => {
    if (failedUpload) URL.revokeObjectURL(failedUpload.previewUrl);
  }, [failedUpload]);
  const previewIndex = preview ? ordered.findIndex((image) => image.id === preview.id) : -1;

  async function send(file: File, replayId: string = uploadId(), retried = false) {
    setBusy(true);
    setFailedUpload(null);
    try {
      await onUpload(campaignId, file, replayId);
    } catch (error) {
      if (!retried) {
        try { await onUpload(campaignId, file, replayId); return; }
        catch (retryError) { error = retryError; }
      }
      const message = error instanceof Error ? error.message : '이미지 업로드에 실패했습니다.';
      setFailedUpload({ file, uploadId: replayId, previewUrl: URL.createObjectURL(file), message });
    } finally { setBusy(false); }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(0, Math.max(0, 10 - images.length));
    event.target.value = '';
    for (const file of files) await send(file);
  }

  function paste(event: ClipboardEvent<HTMLElement>) {
    const file = [...event.clipboardData.files].find((candidate) => candidate.type.startsWith('image/'));
    if (!file || images.length >= 10 || busy) return;
    event.preventDefault();
    void send(file);
  }

  async function move(imageId: string, offset: -1 | 1) {
    const next = moveGalleryImage(ordered, imageId, offset);
    if (next === ordered) return;
    setBusy(true);
    try { await onReorder(campaignId, next.map((image) => image.id)); } finally { setBusy(false); }
  }
  async function remove(imageId: string) {
    setBusy(true);
    try { await onDelete(campaignId, imageId); } finally { setBusy(false); }
  }

  async function drop(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    const ids = ordered.map((image) => image.id);
    const from = ids.indexOf(draggedId); const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]); setDraggedId(null); setBusy(true);
    try { await onReorder(campaignId, ids); } finally { setBusy(false); }
  }

  return <section className="trade-gallery" aria-label={`${symbol} 매매 이미지`} onPaste={paste} tabIndex={0}>
    <div className="gallery-heading"><strong>매매 이미지</strong><label className={`gallery-upload${busy || images.length >= 10 ? ' disabled' : ''}`}><span>{busy ? '업로드 중…' : images.length >= 10 ? '최대 10장' : '이미지 추가'}</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy || images.length >= 10} onChange={(event) => void upload(event)} /></label><span>{images.length}/10</span></div>
    <p className="gallery-help">파일을 여러 개 선택하거나 이 영역에 이미지를 붙여넣으세요.</p>
    <ul className="gallery-grid">{ordered.map((image, index) => <li key={image.id} draggable={!busy} onDragStart={() => setDraggedId(image.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void drop(event, image.id)}>
      <button className="gallery-preview" type="button" onClick={() => setPreview(image)}><img src={imageUrl(campaignId, image.id)} alt={`${symbol} 매매 차트 ${index + 1}`} /></button>
      <div className="gallery-actions"><button className="gallery-order-button gallery-order-left" type="button" disabled={busy || index === 0} onClick={() => void move(image.id, -1)} aria-label={`이미지 ${index + 1} 왼쪽으로 이동`} title="왼쪽으로 이동">‹</button><button className="gallery-order-button gallery-order-right" type="button" disabled={busy || index === ordered.length - 1} onClick={() => void move(image.id, 1)} aria-label={`이미지 ${index + 1} 오른쪽으로 이동`} title="오른쪽으로 이동">›</button><button className="gallery-delete-button" type="button" disabled={busy} onClick={() => void remove(image.id)} aria-label={`이미지 ${index + 1} 삭제`} title="삭제">×</button></div>
    </li>)}</ul>
    {failedUpload ? <div className="gallery-upload-error" role="alert"><img src={failedUpload.previewUrl} alt="업로드에 실패한 이미지 미리보기" /><p>{failedUpload.message}</p><button type="button" className="secondary-button compact" disabled={busy} onClick={() => void send(failedUpload.file, failedUpload.uploadId, true)}>다시 시도</button></div> : null}
    {preview ? <ImageLightbox src={imageUrl(campaignId, preview.id)} alt={`${symbol} 매매 차트 ${previewIndex + 1}`} onClose={() => setPreview(null)} onPrevious={previewIndex > 0 ? () => setPreview(ordered[previewIndex - 1]) : undefined} onNext={previewIndex < ordered.length - 1 ? () => setPreview(ordered[previewIndex + 1]) : undefined} /> : null}
  </section>;
}
