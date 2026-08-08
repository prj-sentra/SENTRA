import { useEffect, useRef } from 'react';

export interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

export function ImageLightbox({ src, alt, onClose, onPrevious, onNext }: ImageLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div ref={dialogRef} className="image-lightbox" role="dialog" aria-modal="true" aria-label="Trade image preview" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <button ref={closeRef} className="lightbox-close" type="button" onClick={onClose} aria-label="Close image preview">×</button>
      <button className="lightbox-previous" type="button" disabled={!onPrevious} onClick={onPrevious} aria-label="Previous image">Previous</button>
      <img src={src} alt={alt} />
      <button className="lightbox-next" type="button" disabled={!onNext} onClick={onNext} aria-label="Next image">Next</button>
    </div>
  );
}
