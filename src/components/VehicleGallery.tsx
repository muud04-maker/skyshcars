'use client';
import { useCallback, useEffect, useState } from 'react';

export default function VehicleGallery({ images, alt }: { images: string[]; alt: string }) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const n = images.length;
  const go = useCallback((d: number) => setI(x => (x + d + n) % n), [n]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, go]);

  if (!n) return null;
  return (
    <>
      <div className="galleryMain">
        <button type="button" className="galleryZoom" onClick={() => setOpen(true)} aria-label="View larger photo">
          <img src={images[i]} alt={`${alt} - photo ${i + 1} of ${n}`} />
        </button>
        {n > 1 && <>
          <button type="button" className="galleryNav prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>
          <button type="button" className="galleryNav next" onClick={() => go(1)} aria-label="Next photo">›</button>
          <span className="galleryCount">{i + 1} / {n}</span>
        </>}
      </div>
      {n > 1 && <div className="galleryThumbs">
        {images.slice(0, 12).map((src, k) => (
          <button type="button" key={src + k} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={`Show photo ${k + 1}`}>
            <img src={src} alt="" loading="lazy" />
          </button>
        ))}
      </div>}
      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={() => setOpen(false)}>
          <button type="button" className="lbClose" onClick={() => setOpen(false)} aria-label="Close">×</button>
          {n > 1 && <button type="button" className="lbNav prev" onClick={e => { e.stopPropagation(); go(-1); }} aria-label="Previous">‹</button>}
          <img src={images[i]} alt={alt} onClick={e => e.stopPropagation()} />
          {n > 1 && <button type="button" className="lbNav next" onClick={e => { e.stopPropagation(); go(1); }} aria-label="Next">›</button>}
        </div>
      )}
    </>
  );
}
