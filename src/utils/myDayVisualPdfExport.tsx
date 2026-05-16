/**
 * Shared “My Day — Visual” PDF pipeline (html2canvas + jsPDF) used by DoctorDayVisual and Practice Scheduler.
 */
import { createRoot } from 'react-dom/client';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  DoctorDayVisualPdfDocument,
  type DoctorDayVisualPdfDocumentProps,
} from '../pages/DoctorDayVisualPdf';

export type MyDayVisualPdfExportArgs = DoctorDayVisualPdfDocumentProps & {
  /** Saved as `${filenameStem}.pdf` */
  filenameStem: string;
};

export async function exportMyDayVisualPdf(args: MyDayVisualPdfExportArgs): Promise<void> {
  const { filenameStem, ...docProps } = args;
  const host = document.createElement('div');
  host.setAttribute('data-myday-visual-pdf', '1');
  host.style.cssText =
    'position:fixed;left:-16000px;top:0;width:1240px;opacity:1;pointer-events:none;z-index:-1;background:#fff;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<DoctorDayVisualPdfDocument {...docProps} />);

    await document.fonts?.ready?.catch(() => undefined);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await new Promise<void>((r) => setTimeout(r, 80));

    const captureEl = (host.firstElementChild as HTMLElement | null) ?? host;
    const headerEl = captureEl.querySelector<HTMLElement>('[data-myday-pdf-header]');
    const rowEls = Array.from(captureEl.querySelectorAll<HTMLElement>('[data-myday-pdf-row]'));

    const captureScale = 2.5;
    const renderToCanvas = (el: HTMLElement) =>
      html2canvas(el, {
        scale: captureScale,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

    const sections: Array<{ canvas: HTMLCanvasElement; gapAfter: number }> = [];
    if (headerEl) {
      sections.push({ canvas: await renderToCanvas(headerEl), gapAfter: 0.06 });
    }
    for (const el of rowEls) {
      sections.push({ canvas: await renderToCanvas(el), gapAfter: 0.04 });
    }

    if (sections.length === 0) {
      console.error('My Day PDF: nothing to render');
      return;
    }

    const pageW = 8.5;
    const pageH = 11;
    const margin = 0.25;
    const maxW = pageW - 2 * margin;
    const maxH = pageH - 2 * margin;
    const refWidthPx = sections[0].canvas.width;
    const inchesPerPx = maxW / refWidthPx;

    const pdf = new jsPDF('portrait', 'in', 'letter');
    let y = margin;
    let firstOnPage = true;
    for (let i = 0; i < sections.length; i++) {
      const { canvas: c, gapAfter } = sections[i];
      const dispW = c.width * inchesPerPx;
      const dispH = c.height * inchesPerPx;
      const fits = y + dispH <= margin + maxH + 1e-6;
      if (!firstOnPage && !fits) {
        pdf.addPage();
        y = margin;
        firstOnPage = true;
      }
      const png = c.toDataURL('image/png');
      pdf.addImage(png, 'PNG', margin, y, dispW, dispH);
      y += dispH + gapAfter;
      firstOnPage = false;
    }

    pdf.save(`${filenameStem}.pdf`);
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }
}
