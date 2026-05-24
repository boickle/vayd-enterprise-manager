// Render a PDF as stacked pages (no browser thumbnail sidebar / PDF chrome)
import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Props = {
  url: string;
  className?: string;
};

export function RoomLoaderPdfCanvas({ url, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;

    const run = async () => {
      setRendering(true);
      setError(null);
      container.replaceChildren();

      try {
        const loading = getDocument(url);
        doc = await loading.promise;
        if (cancelled) return;

        const width = container.clientWidth || 800;

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
          if (cancelled) return;
          const page = await doc.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = width / baseViewport.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.className = 'room-loader-pdf-canvas-page';
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute('aria-label', `Page ${pageNum}`);

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          container.appendChild(canvas);
        }
      } catch {
        if (!cancelled) setError('Could not display PDF.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [url]);

  return (
    <div className={className ?? 'room-loader-pdf-canvas'}>
      {rendering ? <p className="scheduler-modal-muted">Loading PDF…</p> : null}
      {error ? <p className="scheduler-edit-error">{error}</p> : null}
      <div ref={containerRef} className="room-loader-pdf-canvas-pages" />
    </div>
  );
}
