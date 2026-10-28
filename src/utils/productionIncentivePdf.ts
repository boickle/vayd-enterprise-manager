import dayjs from 'dayjs';
import jsPDF from 'jspdf';
import {
  GOAL_PERIOD_LABELS,
  type ProductionIncentiveEvaluation,
  type ProductionIncentiveGoalPeriod,
  type ProductionIncentivePeriod,
  type ProductionIncentiveTierResult,
} from '../api/productionIncentive';

export type ProductionIncentivePdfDoctor = {
  name: string;
  goal: { baseGoal: number; goalPeriod: ProductionIncentiveGoalPeriod };
  evaluation: ProductionIncentiveEvaluation;
  payout: ProductionIncentiveEvaluation;
  membership?: ProductionIncentivePdfMembership | null;
};

export type ProductionIncentivePdfMembership = {
  percent: number | null;
  members: number;
  patients: number;
  /** YYYY-MM-DD the counts were taken on. */
  asOf: string;
};

export type ProductionIncentivePdfInput = {
  period: ProductionIncentivePeriod;
  payoutPeriod: ProductionIncentivePeriod;
  granularityLabel: string;
  doctors: ProductionIncentivePdfDoctor[];
  /** Shown only when the PDF covers more than one doctor. */
  practiceMembership?: ProductionIncentivePdfMembership | null;
  /** YYYY-MM-DD the figures were prepared. */
  generatedOn?: string;
  notes?: string;
};

function membershipText(label: string, m: ProductionIncentivePdfMembership): string {
  return `${label}: ${pct(m.percent)} (${m.members.toLocaleString('en-US')} of ${m.patients.toLocaleString('en-US')} patients) as of ${dayjs(m.asOf).format('MMM D, YYYY')}`;
}

type RGB = [number, number, number];

const PAGE_W = 8.5;
const PAGE_H = 11;
const MARGIN_X = 0.6;
const MARGIN_BOTTOM = 0.55;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const INK: RGB = [33, 37, 41];
const MUTED: RGB = [107, 114, 128];
const BRAND: RGB = [75, 124, 106];
const LINE: RGB = [229, 231, 235];
const HEADER_BG: RGB = [243, 244, 246];
const NOTE_BG: RGB = [240, 247, 244];
const REACHED: RGB = [46, 125, 50];

function usd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function pct(n: number | null): string {
  return n == null ? '-' : `${n.toFixed(1)}%`;
}

/** Standard PDF fonts only cover WinAnsi, so normalize punctuation first. */
function pdfSafe(s: string): string {
  return s
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2026/g, '...');
}

function slug(s: string): string {
  const cleaned = pdfSafe(s)
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || 'report';
}

export function productionIncentivePdfFilename(input: ProductionIncentivePdfInput): string {
  const who = input.doctors.length === 1 ? input.doctors[0].name : 'All_Doctors';
  return `Production_Incentive_${slug(who)}_${slug(input.period.label)}.pdf`;
}

function setFill(pdf: jsPDF, c: RGB) {
  pdf.setFillColor(c[0], c[1], c[2]);
}

function setText(pdf: jsPDF, c: RGB) {
  pdf.setTextColor(c[0], c[1], c[2]);
}

function setDraw(pdf: jsPDF, c: RGB) {
  pdf.setDrawColor(c[0], c[1], c[2]);
}

/** Point size to inches. jsPDF's getLineHeight() stays in points even when the page unit is inches. */
function leading(sizePt: number): number {
  return (sizePt * 1.35) / 72;
}

export function buildProductionIncentiveReportPdf(input: ProductionIncentivePdfInput): jsPDF {
  const { period, payoutPeriod, doctors } = input;
  const isPayout = period.start === payoutPeriod.start && period.end === payoutPeriod.end;
  const notes = input.notes?.trim();
  const pdf = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });
  pdf.setProperties({
    title: pdfSafe(`Production incentive - ${period.label}`),
    subject: 'Production incentive report',
  });

  const contentBottom = PAGE_H - MARGIN_BOTTOM;

  const drawRunningHeader = (): number => {
    setFill(pdf, BRAND);
    pdf.rect(0, 0, PAGE_W, 0.08, 'F');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    setText(pdf, MUTED);
    pdf.text(pdfSafe(`Production incentive - ${period.label} (continued)`), MARGIN_X, 0.36);
    return 0.58;
  };

  let y = 0.42;
  let pageCount = 1;
  const newPage = (): number => {
    pdf.addPage();
    pageCount += 1;
    return drawRunningHeader();
  };
  const ensure = (needed: number): void => {
    if (y + needed > contentBottom) y = newPage();
  };

  const writeLines = (
    lines: string[],
    size: number,
    color: RGB,
    font: 'normal' | 'bold' = 'normal'
  ) => {
    if (!lines.length) return;
    const lh = leading(size);
    let index = 0;
    while (index < lines.length) {
      let fit = Math.floor((contentBottom - y) / lh);
      if (fit < 1) {
        y = newPage();
        fit = Math.max(1, Math.floor((contentBottom - y) / lh));
      }
      const chunk = lines.slice(index, index + fit);
      pdf.setFont('helvetica', font);
      pdf.setFontSize(size);
      setText(pdf, color);
      chunk.forEach((line, i) => {
        pdf.text(line, MARGIN_X, y + lh * 0.8 + i * lh);
      });
      y += chunk.length * lh;
      index += chunk.length;
    }
  };

  const wrap = (text: string, size: number, width = CONTENT_W): string[] => {
    pdf.setFontSize(size);
    return pdf.splitTextToSize(pdfSafe(text), width) as string[];
  };

  setFill(pdf, BRAND);
  pdf.rect(0, 0, PAGE_W, 0.08, 'F');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  setText(pdf, BRAND);
  pdf.text('Vet At Your Door', MARGIN_X, y);
  y += 0.22;

  writeLines([pdfSafe(`Production incentive - ${period.label}`)], 16, INK, 'bold');
  y += 0.06;
  writeLines([pdfSafe(`${input.granularityLabel} - ${period.start} to ${period.end}`)], 10, MUTED);
  if (period.status === 'in_progress') {
    writeLines(
      [`Period in progress: day ${period.elapsedDays} of ${period.totalDays}.`],
      10,
      MUTED
    );
  }
  if (input.generatedOn) {
    const prepared = dayjs(input.generatedOn).isValid()
      ? dayjs(input.generatedOn).format('MMMM D, YYYY')
      : input.generatedOn;
    writeLines([`Prepared ${prepared}.`], 9, MUTED);
  }
  if (input.practiceMembership && doctors.length > 1) {
    y += 0.04;
    writeLines(wrap(membershipText('Practice membership', input.practiceMembership), 10), 10, INK);
    y += 0.12;
  }
  y += 0.08;

  if (notes) {
    pdf.setFont('helvetica', 'normal');
    const noteLines = wrap(notes, 10, CONTENT_W - 0.28);
    const noteLh = leading(10);
    let index = 0;
    while (index < noteLines.length) {
      let fit = Math.floor((contentBottom - y - 0.14) / noteLh);
      if (fit < 1) {
        y = newPage();
        fit = Math.max(1, Math.floor((contentBottom - y - 0.14) / noteLh));
      }
      const chunk = noteLines.slice(index, index + fit);
      const boxH = chunk.length * noteLh + 0.14;
      setFill(pdf, NOTE_BG);
      pdf.rect(MARGIN_X, y, CONTENT_W, boxH, 'F');
      setFill(pdf, BRAND);
      pdf.rect(MARGIN_X, y, 0.06, boxH, 'F');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      setText(pdf, INK);
      chunk.forEach((line, i) => {
        pdf.text(line, MARGIN_X + 0.16, y + 0.16 + i * noteLh);
      });
      y += boxH + 0.1;
      index += chunk.length;
    }
    y += 0.1;
  }

  const drawTierTable = (tiers: ProductionIncentiveTierResult[]) => {
    type Col = {
      label: string;
      width: number;
      align: 'left' | 'right';
      value: (t: ProductionIncentiveTierResult) => { text: string; color: RGB };
    };
    const statusW = isPayout ? CONTENT_W - 5.15 : CONTENT_W - 3.2;
    const cols: Col[] = [
      {
        label: 'Tier',
        width: 1.15,
        align: 'left',
        value: (t) => ({ text: `${t.percent}%`, color: INK }),
      },
      {
        label: 'Goal',
        width: 2.05,
        align: 'right',
        value: (t) => ({ text: usd(t.goal), color: INK }),
      },
    ];
    if (isPayout) {
      cols.push({
        label: 'Bonus pool',
        width: 1.95,
        align: 'right',
        value: (t) => ({
          text: t.percent > 100 ? `${usd(t.pool)} (${t.marginShare}%)` : '-',
          color: INK,
        }),
      });
    }
    cols.push({
      label: 'Status',
      width: statusW,
      align: 'right',
      value: (t) =>
        t.achieved
          ? { text: 'Reached', color: REACHED }
          : { text: `${usd(t.remaining)} to go`, color: INK },
    });

    const rowH = 0.28;
    const drawHeader = () => {
      ensure(rowH);
      setFill(pdf, HEADER_BG);
      pdf.rect(MARGIN_X, y, CONTENT_W, rowH, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      setText(pdf, INK);
      let x = MARGIN_X;
      for (const col of cols) {
        const tx = col.align === 'right' ? x + col.width - 0.08 : x + 0.08;
        pdf.text(col.label, tx, y + 0.18, { align: col.align });
        x += col.width;
      }
      y += rowH;
    };

    drawHeader();
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    for (const tier of tiers) {
      if (y + rowH > contentBottom) {
        y = newPage();
        drawHeader();
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
      }
      setDraw(pdf, LINE);
      pdf.setLineWidth(0.008);
      pdf.line(MARGIN_X, y + rowH, MARGIN_X + CONTENT_W, y + rowH);
      let x = MARGIN_X;
      for (const col of cols) {
        const cell = col.value(tier);
        setText(pdf, cell.color);
        const tx = col.align === 'right' ? x + col.width - 0.08 : x + 0.08;
        pdf.text(pdfSafe(cell.text), tx, y + 0.18, { align: col.align });
        x += col.width;
      }
      y += rowH;
    }
  };

  doctors.forEach((doctor, index) => {
    const ev = doctor.evaluation;
    const bonus = bonusText(doctor.payout, payoutPeriod);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    const nameLines = wrap(doctor.name, 13);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    const goalLine = wrap(
      `Goal basis: ${usd(doctor.goal.baseGoal)} ${GOAL_PERIOD_LABELS[doctor.goal.goalPeriod].toLowerCase()}`,
      10
    );
    const vsdLine = wrap(
      `VSD: ${usd(ev.actual)} of ${usd(ev.goal)} goal (${pct(ev.percentOfGoal)})`,
      10
    );
    const paceLine =
      ev.projected != null
        ? wrap(`On pace for ${usd(ev.projected)} (${pct(ev.projectedPercentOfGoal)} of goal)`, 10)
        : [];
    const payoutLine = isPayout
      ? []
      : wrap(
          `Payout period ${payoutPeriod.label}: ${usd(doctor.payout.actual)} of ${usd(doctor.payout.goal)} goal (${pct(doctor.payout.percentOfGoal)})${
            payoutPeriod.status === 'in_progress' ? ' (in progress)' : ''
          }`,
          10
        );
    pdf.setFontSize(10);
    const bonusLines = bonus ? wrap(bonus, 10) : [];
    const membershipLines = doctor.membership
      ? wrap(membershipText('Team membership', doctor.membership), 10)
      : [];
    const blockHeight =
      nameLines.length * leading(13) +
      (goalLine.length +
        vsdLine.length +
        paceLine.length +
        payoutLine.length +
        bonusLines.length +
        membershipLines.length) *
        leading(10) +
      0.12 +
      (ev.tiers.length + 1) * 0.28;
    const withRule = index > 0 ? blockHeight + 0.36 : blockHeight;
    const fitsOnFreshPage = withRule < contentBottom - 0.7;
    if (y + withRule > contentBottom && fitsOnFreshPage) {
      y = newPage();
    } else if (index > 0) {
      y += 0.16;
      setDraw(pdf, LINE);
      pdf.setLineWidth(0.012);
      pdf.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
      y += 0.2;
    }

    writeLines(nameLines, 13, INK, 'bold');
    y += 0.02;
    writeLines(goalLine, 10, MUTED);
    writeLines(vsdLine, 10, INK);
    if (paceLine.length) writeLines(paceLine, 10, INK);
    if (payoutLine.length) writeLines(payoutLine, 10, INK);
    if (bonusLines.length) writeLines(bonusLines, 10, INK, 'bold');
    if (membershipLines.length) writeLines(membershipLines, 10, INK);
    y += 0.08;
    drawTierTable(ev.tiers);
  });

  y += 0.22;
  writeLines(
    ['VSD is treatment value on the visit date (membership plan payments excluded).'],
    8,
    MUTED
  );

  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    setText(pdf, MUTED);
    pdf.text(`${i} of ${pageCount}`, PAGE_W - MARGIN_X, PAGE_H - 0.32, { align: 'right' });
  }

  return pdf;
}

function bonusText(
  ev: ProductionIncentiveEvaluation,
  payout: ProductionIncentivePeriod
): string | null {
  if (!ev.bonus) return null;
  const soFar = payout.status === 'in_progress' ? ' (earned so far)' : '';
  return (
    `Bonus for ${payout.label}${soFar} at the ${ev.bonus.tierPercent}% tier: ${usd(ev.bonus.pool)}` +
    ` - DVM ${usd(ev.bonus.dvm)} (${ev.dvmSharePercent}%), tech ${usd(ev.bonus.tech)} (${100 - ev.dvmSharePercent}%)`
  );
}

export function downloadProductionIncentiveReportPdf(input: ProductionIncentivePdfInput): string {
  const filename = productionIncentivePdfFilename(input);
  buildProductionIncentiveReportPdf(input).save(filename);
  return filename;
}
