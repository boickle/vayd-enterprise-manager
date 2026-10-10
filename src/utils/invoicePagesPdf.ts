import jsPDF from 'jspdf';

/** Longest edge of a page photo before it is placed in the combined invoice PDF. */
const MAX_EDGE_PX = 1600;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name || 'photo'}`));
    };
    img.src = url;
  });
}

function imageToJpeg(img: HTMLImageElement): { dataUrl: string; width: number; height: number } {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error('Photo has no size');
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare invoice pages');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width, height };
}

/** One PDF, one page per photo, in the order the pages were added. */
export async function imagesToInvoicePdf(files: File[]): Promise<File> {
  if (files.length === 0) throw new Error('Add at least one page');
  let doc: jsPDF | null = null;
  for (const file of files) {
    const img = await loadImage(file);
    const { dataUrl, width, height } = imageToJpeg(img);
    const orientation = width >= height ? 'l' : 'p';
    if (!doc) {
      doc = new jsPDF({ unit: 'pt', format: [width, height], orientation, compress: true });
    } else {
      doc.addPage([width, height], orientation);
    }
    doc.addImage(dataUrl, 'JPEG', 0, 0, width, height);
  }
  if (!doc) throw new Error('Could not prepare invoice pages');
  const blob = doc.output('blob');
  return new File([blob], 'invoice-pages.pdf', { type: 'application/pdf' });
}
