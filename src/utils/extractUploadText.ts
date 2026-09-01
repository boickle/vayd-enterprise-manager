import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ExtractedUpload = {
  text: string;
  images: { mimeType: string; base64: string }[];
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

function dataUrlToImage(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1]!, base64: match[2]! };
}

async function renderPdfPage(page: {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  // pdfjs RenderParameters is stricter than the fields we pass.
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => {
    promise: Promise<unknown>;
  };
}): Promise<{ mimeType: string; base64: string } | null> {
  const viewport = page.getViewport({ scale: 1.25 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(1400, Math.floor(viewport.width));
  canvas.height = Math.floor((viewport.height * canvas.width) / viewport.width);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const scaled = page.getViewport({ scale: canvas.width / viewport.width });
  await page.render({ canvasContext: ctx, viewport: scaled }).promise;
  return dataUrlToImage(canvas.toDataURL('image/jpeg', 0.72));
}

export async function extractTextFromUpload(file: File): Promise<ExtractedUpload> {
  if (file.type.startsWith('image/')) {
    const dataUrl = await readAsDataUrl(file);
    const image = dataUrlToImage(dataUrl);
    return { text: '', images: image ? [image] : [] };
  }

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const data = await file.arrayBuffer();
    const pdf = await getDocument({ data }).promise;
    const pages: string[] = [];
    const maxPages = Math.min(pdf.numPages, 40);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ('str' in item ? String(item.str) : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
    }
    const text = pages.filter(Boolean).join('\n\n');
    if (text.length >= 80) return { text, images: [] };

    const images: { mimeType: string; base64: string }[] = [];
    const renderCount = Math.min(pdf.numPages, 3);
    for (let i = 1; i <= renderCount; i++) {
      const page = await pdf.getPage(i);
      const image = await renderPdfPage(page as never);
      if (image) images.push(image);
    }
    return { text, images };
  }

  return { text: await file.text(), images: [] };
}
