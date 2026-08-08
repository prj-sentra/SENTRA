import { useEffect, useRef } from 'react';

export interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Trade image preview" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <button ref={closeRef} className="lightbox-close" type="button" onClick={onClose} aria-label="Close image preview">×</button>
      <img src={src} alt={alt} />
    </div>
  );
}
