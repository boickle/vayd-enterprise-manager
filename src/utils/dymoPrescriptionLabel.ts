import { VAYD_LABEL_LOGO_PNG_BASE64 } from './vaydLabelLogo';

export type DymoPrinter = {
  name: string;
  modelName: string | null;
  isConnected: boolean;
};

export type PrescriptionLabelData = {
  practiceName: string;
  practiceAddress: string;
  practicePhone: string;
  patientName: string;
  species: string;
  ownerName: string;
  prescriptionNumber: string;
  prescribedDate: string;
  drugName: string;
  strength: string;
  quantity: string;
  instructions: string;
  refills: string;
  discardAfter: string;
  veterinarianName: string;
  veterinarianLicense: string;
};

type DymoService = { host: string; port: number };

const SERVICE_PATH = 'DYMO/DLS/Printing';
const START_PORT = 41951;
const END_PORT = 41960;

function serviceUrl(service: DymoService, command: string): string {
  return `https://${service.host}:${service.port}/${SERVICE_PATH}/${command}`;
}

async function findDymoService(): Promise<DymoService> {
  const probes: Promise<DymoService>[] = [];
  for (const host of ['127.0.0.1', 'localhost']) {
    for (let port = START_PORT; port <= END_PORT; port += 1) {
      probes.push(
        fetch(`https://${host}:${port}/${SERVICE_PATH}/StatusConnected`).then((response) => {
          if (!response.ok) throw new Error(response.statusText);
          return { host, port };
        })
      );
    }
  }

  try {
    return await new Promise<DymoService>((resolve, reject) => {
      let remaining = probes.length;
      probes.forEach((probe) => {
        void probe.then(resolve).catch(() => {
          remaining -= 1;
          if (remaining === 0) reject(new Error('No DYMO service found.'));
        });
      });
    });
  } catch {
    throw new Error(
      'DYMO Connect is not running. Install or open DYMO Connect on this computer, then try again.'
    );
  }
}

function childText(element: Element, selector: string): string {
  return element.querySelector(selector)?.textContent?.trim() ?? '';
}

export async function listDymoPrinters(): Promise<DymoPrinter[]> {
  const service = await findDymoService();
  const response = await fetch(serviceUrl(service, 'GetPrinters'));
  if (!response.ok) throw new Error('Could not read the DYMO printer list.');

  const xml = new DOMParser().parseFromString(await response.text(), 'text/xml');
  if (xml.querySelector('parsererror')) throw new Error('DYMO returned an invalid printer list.');

  return [...xml.querySelectorAll('LabelWriterPrinter')]
    .map((element) => ({
      name: childText(element, 'Name'),
      modelName: childText(element, 'ModelName') || null,
      isConnected: childText(element, 'IsConnected').toLowerCase() === 'true',
    }))
    .filter((printer) => printer.name);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type LabelSegment = {
  text: string;
  size: number;
  bold: boolean;
  align?: 'Left' | 'Center';
  /** Keeps the block clear of the logo in the top-left corner. */
  inset?: boolean;
};

/**
 * The label reads top-down as: who dispensed it, who it is for, what it is, and how to
 * give it. The drug and the sig are set larger because those are the two lines an owner
 * actually acts on.
 */
function labelSegments(data: PrescriptionLabelData): LabelSegment[] {
  const provider = data.veterinarianLicense
    ? `${data.veterinarianName} · Lic ${data.veterinarianLicense}`
    : data.veterinarianName;
  const patient = [data.patientName, data.species].filter(Boolean).join(' · ');
  const drug = [data.drugName, data.strength].filter(Boolean).join(' ');

  const segments: LabelSegment[] = [
    { text: data.practiceName, size: 9, bold: true, align: 'Center', inset: true },
    {
      text: `${data.practiceAddress} · Tel ${data.practicePhone}`,
      size: 6,
      bold: false,
      align: 'Center',
      inset: true,
    },
    {
      text: [
        `Patient: ${patient}    Owner: ${data.ownerName}`,
        `Rx: ${data.prescriptionNumber}    Date: ${data.prescribedDate}`,
      ].join('\n'),
      size: 7,
      bold: false,
    },
    { text: `${drug}    Qty: ${data.quantity}`, size: 10, bold: true },
    { text: data.instructions, size: 8, bold: true },
    {
      text: [
        `Refills: ${data.refills}    Discard after: ${data.discardAfter}`,
        `Prescriber: ${provider}`,
      ].join('\n'),
      size: 7,
      bold: false,
    },
    {
      text: 'FOR VETERINARY USE ONLY · KEEP OUT OF REACH OF CHILDREN',
      size: 6,
      bold: true,
      align: 'Center',
    },
    {
      text: 'Caution: Federal law restricts this drug to use by or on the order of a licensed veterinarian.',
      size: 5,
      bold: false,
    },
  ];

  return segments.filter((segment) => segment.text.trim());
}

function formatLabelText(data: PrescriptionLabelData): string {
  return labelSegments(data)
    .map((segment) => segment.text)
    .join('\n');
}

/** 30326 roll, in twips: 3-1/10" along the long edge, 1-4/5" along the short edge. */
const LABEL_LONG = 4464;
const LABEL_SHORT = 2592;
/**
 * DYMO clamps objects into the media's printable area rather than reporting an error, and
 * on this roll that left boundary sits ~350 twips in. Anything declared further left
 * silently slides right and collides with whatever sits beside it, so the margins below
 * were measured against the Connect render service rather than assumed.
 */
const MARGIN_LEFT = 360;
const MARGIN_RIGHT = 200;
const MARGIN_TOP = 130;
const MARGIN_BOTTOM = 130;
const TEXT_WIDTH = LABEL_LONG - MARGIN_LEFT - MARGIN_RIGHT;
/** Corner column reserved for the logo, plus the gap before the header text. */
const LOGO_WIDTH = 420;
const LOGO_GAP = 70;

function segmentWidth(segment: LabelSegment): number {
  return segment.inset ? TEXT_WIDTH - LOGO_WIDTH - LOGO_GAP : TEXT_WIDTH;
}

/**
 * Wraps on our side because DYMO shrinks an over-long line instead of breaking it, which
 * turns a wordy sig into unreadable text. Arial averages roughly half the point size per
 * character, and a point is 20 twips.
 */
function wrapText(text: string, size: number, bold: boolean, width: number): string {
  const charWidth = size * 20 * (bold ? 0.54 : 0.5);
  const maxChars = Math.max(12, Math.floor(width / charWidth));

  return text
    .split('\n')
    .map((paragraph) => {
      const lines: string[] = [];
      let current = '';
      // Whitespace runs are kept as tokens so the padded column gaps survive intact.
      for (const token of paragraph.match(/\S+|\s+/g) ?? []) {
        if (!current && /^\s+$/.test(token)) continue;
        if (current && !/^\s+$/.test(token) && current.length + token.length > maxChars) {
          lines.push(current.replace(/\s+$/, ''));
          current = token;
        } else {
          current += token;
        }
      }
      if (current.trim()) lines.push(current.replace(/\s+$/, ''));
      return lines.join('\n');
    })
    .join('\n');
}

function textObjectXml(segment: LabelSegment, index: number, y: number, height: number): string {
  return `  <ObjectInfo>
    <TextObject>
      <Name>Line${index}</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
      <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <HorizontalAlignment>${segment.align ?? 'Left'}</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <TextFitMode>ShrinkToFit</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>
        <Element>
          <String>${escapeXml(segment.text)}</String>
          <Attributes>
            <Font Family="Arial" Size="${segment.size}" Bold="${segment.bold ? 'True' : 'False'}" Italic="False" Underline="False" Strikeout="False" />
            <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
          </Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="${MARGIN_LEFT + (segment.inset ? LOGO_WIDTH + LOGO_GAP : 0)}" Y="${Math.round(y)}" Width="${segmentWidth(segment)}" Height="${Math.round(height)}" />
  </ObjectInfo>`;
}

/**
 * Uniform scaling keeps the square mark undistorted and centered inside whatever vertical
 * span the header blocks ended up occupying.
 */
function logoObjectXml(height: number): string {
  return `  <ObjectInfo>
    <ImageObject>
      <Name>Logo</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
      <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <Image>${VAYD_LABEL_LOGO_PNG_BASE64}</Image>
      <ScaleMode>Uniform</ScaleMode>
      <BorderWidth>0</BorderWidth>
      <BorderColor Alpha="255" Red="0" Green="0" Blue="0" />
      <VerticalAlignment>Center</VerticalAlignment>
      <HorizontalAlignment>Center</HorizontalAlignment>
    </ImageObject>
    <Bounds X="${MARGIN_LEFT}" Y="${MARGIN_TOP}" Width="${LOGO_WIDTH}" Height="${Math.round(height)}" />
  </ObjectInfo>`;
}

/**
 * DLS label XML for the DYMO 30326 roll (1-4/5" × 3-1/10"), landscape so the long edge
 * runs horizontally.
 *
 * Each block is its own text object rather than one styled run: DYMO concatenates styled
 * elements without honoring the line breaks between them, so mixing font sizes only works
 * across separate objects. Blocks divide the label's height by weight and shrink to fit,
 * which keeps a long sig from pushing the warnings off the label.
 */
export function buildPrescriptionLabelXml(data: PrescriptionLabelData): string {
  const blocks = labelSegments(data).map((segment) => {
    const text = wrapText(segment.text, segment.size, segment.bold, segmentWidth(segment));
    // Weighting by lines × point size keeps every block at the same effective scale, so a
    // long sig steals space from the rest of the label instead of shrinking on its own.
    return { ...segment, text, weight: text.split('\n').length * segment.size };
  });
  const totalWeight = blocks.reduce((sum, block) => sum + block.weight, 0);
  const usableHeight = LABEL_SHORT - MARGIN_TOP - MARGIN_BOTTOM;

  let offset = MARGIN_TOP;
  let logoHeight = 0;
  const objects = blocks.map((block, index) => {
    const height = (block.weight / totalWeight) * usableHeight;
    const xml = textObjectXml(block, index, offset, height);
    if (block.inset) logoHeight += height;
    offset += height;
    return xml;
  });
  if (logoHeight > 0) objects.unshift(logoObjectXml(logoHeight));

  return `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>VideoTop</Id>
  <PaperName>30326 Video Top</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="${LABEL_SHORT}" Height="${LABEL_LONG}" Rx="180" Ry="180" />
  </DrawCommands>
${objects.join('\n')}
</DieCutLabel>`;
}

export async function printPrescriptionLabel(
  printerName: string,
  data: PrescriptionLabelData
): Promise<void> {
  const service = await findDymoService();
  const body = new URLSearchParams({
    printerName,
    printParamsXml: '',
    labelXml: buildPrescriptionLabelXml(data),
    labelSetXml: '',
  });
  const response = await fetch(serviceUrl(service, 'PrintLabel'), { method: 'POST', body });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || 'DYMO could not print the prescription label.');
  }
}

export function printPrescriptionLabelWithSystemDialog(
  data: PrescriptionLabelData,
  existingWindow?: Window | null
): void {
  const printWindow = existingWindow ?? window.open('', '_blank', 'popup,width=720,height=500');
  if (!printWindow) throw new Error('Allow pop-ups to use the system print dialog.');

  const lines = formatLabelText(data)
    .split('\n')
    .map((line, index) => `<div class="${index === 0 ? 'practice' : ''}">${escapeXml(line)}</div>`)
    .join('');

  printWindow.document.write(`<!doctype html>
<html><head><title>Prescription label</title><style>
@page { size: 3.1in 1.8in; margin: 0; }
* { box-sizing: border-box; }
html, body { width: 3.1in; height: 1.8in; margin: 0; }
body { padding: .08in; font: 7pt/1.12 Arial, sans-serif; color: #000; overflow: hidden; }
.practice { font-size: 8.5pt; font-weight: 700; }
.logo { float: left; width: .28in; height: .28in; margin: 0 .06in .02in 0; }
</style></head><body><img class="logo" alt="" src="data:image/png;base64,${VAYD_LABEL_LOGO_PNG_BASE64}" />${lines}<script>window.onload=()=>{window.print();window.close();}</script></body></html>`);
  printWindow.document.close();
}
