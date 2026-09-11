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
  /** Mail-order number printed on the Rx label so it matches the bag label. */
  mailOrderNumber?: string | null;
  prescribedDate: string;
  drugName: string;
  strength: string;
  quantity: string;
  instructions: string;
  refills: string;
  discardAfter: string;
  veterinarianName: string;
  veterinarianLicense: string;
  veterinarianSignaturePng?: string | null;
  /** PNG/JPEG data URL or raw PNG base64. Falls back to the built-in VAYD mark. */
  practiceLogoPng?: string | null;
};

type DymoService = { protocol: 'http' | 'https'; host: string; port: number };

const SERVICE_PATH = 'DYMO/DLS/Printing';
const START_PORT = 41951;
const END_PORT = 41960;

function serviceUrl(service: DymoService, command: string): string {
  return `${service.protocol}://${service.host}:${service.port}/${SERVICE_PATH}/${command}`;
}

function probeSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(2500)
    : undefined;
}

function raceDymoProbes(protocol: DymoService['protocol']): Promise<DymoService> {
  const signal = probeSignal();
  const probes: Promise<DymoService>[] = [];
  for (const host of ['127.0.0.1', 'localhost']) {
    for (let port = START_PORT; port <= END_PORT; port += 1) {
      probes.push(
        fetch(`${protocol}://${host}:${port}/${SERVICE_PATH}/StatusConnected`, { signal }).then(
          (response) => {
            if (!response.ok) throw new Error(response.statusText);
            return { protocol, host, port };
          }
        )
      );
    }
  }

  return new Promise<DymoService>((resolve, reject) => {
    let remaining = probes.length;
    probes.forEach((probe) => {
      void probe.then(resolve).catch(() => {
        remaining -= 1;
        if (remaining === 0) reject(new Error('No DYMO service found.'));
      });
    });
  });
}

/**
 * Current DYMO.WebApi.Mac.Host speaks HTTP on 41951 and rejects TLS.
 * Older Connect builds are HTTPS-only with a self-signed cert. Probe the
 * protocol that matches the page first so Vite (http) and hosted (https)
 * each hit a reachable service without mixed-content noise.
 */
async function findDymoService(): Promise<DymoService> {
  const pageIsHttps = typeof location !== 'undefined' && location.protocol === 'https:';
  const protocols: Array<DymoService['protocol']> = pageIsHttps
    ? ['https', 'http']
    : ['http', 'https'];

  for (const protocol of protocols) {
    try {
      return await raceDymoProbes(protocol);
    } catch {
      // try the other protocol
    }
  }

  throw new Error(
    'This page cannot reach the DYMO web service. DYMO Connect can sit in the menu bar while its web service is unreachable — click the DYMO icon, choose Diagnose, then try again.'
  );
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

function pngFromDataUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^data:image\/(?:png|jpeg|jpg);base64,(.+)$/i);
  return match?.[1] ?? null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type LabelBand = {
  text: string;
  size: number;
  bold: boolean;
  align?: 'Left' | 'Center';
  /** Keeps the block clear of the logo in the top-left corner. */
  inset?: boolean;
  height: number;
  y: number;
  valign?: 'Top' | 'Middle';
};

function providerLine(data: PrescriptionLabelData): string {
  return data.veterinarianName;
}

function drugLine(data: PrescriptionLabelData): string {
  return [data.drugName, data.strength].filter(Boolean).join(' ');
}

function ownerMetaLine(data: PrescriptionLabelData): string {
  const owner = data.ownerName ? `Owner: ${data.ownerName}` : '';
  const facts = [data.quantity ? `Qty: ${data.quantity}` : '', dateLine(data)]
    .filter(Boolean)
    .join('    ');
  return [owner, facts].filter(Boolean).join('\n');
}

function dateLine(data: PrescriptionLabelData): string {
  const rx = data.prescriptionNumber.trim();
  const mo = (data.mailOrderNumber || '').trim();
  return [
    rx ? `Rx: ${rx}` : '',
    mo ? `MO: ${mo}` : '',
    data.prescribedDate ? `Date: ${data.prescribedDate}` : '',
  ]
    .filter(Boolean)
    .join('    ');
}

function footerLine(data: PrescriptionLabelData): string {
  const refills = Number(data.refills);
  return [
    Number.isFinite(refills) && refills > 0 ? `Refills: ${data.refills}` : '',
    `Discard after: ${data.discardAfter}`,
    data.veterinarianName ? `Prescriber: ${providerLine(data)}` : '',
  ]
    .filter(Boolean)
    .join('    ');
}

/**
 * 21 CFR 201.105 requires this legend on the manufacturer's prescription-animal-drug
 * label. Clinic-dispensed labels must still carry directions and cautionary statements
 * (AVMA + 21 CFR 530.12 for extralabel use). Keep it, but as the smallest line.
 */
const VETERINARY_CAUTION =
  'Caution: Federal law restricts this drug to use by or on the order of a licensed veterinarian.';

/** Directions are a reserved 4-line band. Staff see this limit before print. */
export const DIRECTIONS_POINT_SIZE = 8;
export const DIRECTIONS_MAX_LINES = 4;
const CHAR_WIDTH_BOLD = 0.46;
const CHAR_WIDTH_REGULAR = 0.44;

/** 30326 roll, in twips: 3-1/10" along the long edge, 1-4/5" along the short edge. */
const LABEL_LONG = 4464;
const LABEL_SHORT = 2592;
/**
 * DYMO clamps objects into the media's printable area rather than reporting an error, and
 * on this roll that left boundary sits ~350 twips in. Anything declared further left
 * silently slides right and collides with whatever sits beside it, so the margins below
 * were measured against the Connect render service rather than assumed.
 */
/**
 * The 30326 die-cut has a real unprintable collar. Pushing objects closer than this
 * clips glyphs even when the sticker looks like it has room — the header cannot sit
 * any higher than the top inset, and the caution cannot sit any lower than the bottom.
 */
const MARGIN_LEFT = 360;
const MARGIN_RIGHT = 160;
const MARGIN_TOP = 170;
const MARGIN_BOTTOM = 200;
const TEXT_WIDTH = LABEL_LONG - MARGIN_LEFT - MARGIN_RIGHT;
/** Corner column reserved for the logo, plus the gap before the header text. */
const LOGO_WIDTH = 340;
const LOGO_GAP = 40;
const LINE_HEIGHT = 1.08;

function bandWidth(inset?: boolean): number {
  return inset ? TEXT_WIDTH - LOGO_WIDTH - LOGO_GAP : TEXT_WIDTH;
}

function lineHeightTwips(size: number): number {
  return size * 20 * LINE_HEIGHT;
}

function charsPerLine(size: number, bold: boolean, width: number): number {
  return Math.max(12, Math.floor(width / (size * 20 * (bold ? CHAR_WIDTH_BOLD : CHAR_WIDTH_REGULAR))));
}

export function directionsCharacterLimit(): number {
  return charsPerLine(DIRECTIONS_POINT_SIZE, true, TEXT_WIDTH) * DIRECTIONS_MAX_LINES;
}

export function directionsWrappedLineCount(text: string): number {
  return wrapText(text.trim(), DIRECTIONS_POINT_SIZE, true, TEXT_WIDTH).split('\n').filter(Boolean).length;
}

export function directionsFitsLabel(text: string): boolean {
  return directionsWrappedLineCount(text) <= DIRECTIONS_MAX_LINES;
}

function neededHeight(text: string, size: number): number {
  const lines = text.split('\n').filter(Boolean).length || 1;
  return Math.ceil(lines * lineHeightTwips(size));
}

function logoPng(data: PrescriptionLabelData): string {
  return pngFromDataUrl(data.practiceLogoPng) ?? VAYD_LABEL_LOGO_PNG_BASE64;
}

/**
 * Wraps on our side because DYMO shrinks an over-long line instead of breaking it, which
 * turns a wordy sig into unreadable text. Arial averages roughly half the point size per
 * character, and a point is 20 twips.
 */
function wrapText(text: string, size: number, bold: boolean, width: number): string {
  const charWidth = size * 20 * (bold ? CHAR_WIDTH_BOLD : CHAR_WIDTH_REGULAR);
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

function textObjectXml(band: LabelBand, index: number): string {
  return `  <ObjectInfo>
    <TextObject>
      <Name>Line${index}</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
      <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <HorizontalAlignment>${band.align ?? 'Left'}</HorizontalAlignment>
      <VerticalAlignment>${band.valign ?? 'Middle'}</VerticalAlignment>
      <TextFitMode>None</TextFitMode>
      <UseFullFontHeight>False</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>
        <Element>
          <String>${escapeXml(band.text)}</String>
          <Attributes>
            <Font Family="Arial" Size="${band.size}" Bold="${band.bold ? 'True' : 'False'}" Italic="False" Underline="False" Strikeout="False" />
            <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
          </Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="${MARGIN_LEFT + (band.inset ? LOGO_WIDTH + LOGO_GAP : 0)}" Y="${Math.round(band.y)}" Width="${bandWidth(band.inset)}" Height="${Math.round(band.height)}" />
  </ObjectInfo>`;
}

function logoObjectXml(png: string, height: number): string {
  return `  <ObjectInfo>
    <ImageObject>
      <Name>Logo</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
      <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <Image>${png}</Image>
      <ScaleMode>Uniform</ScaleMode>
      <BorderWidth>0</BorderWidth>
      <BorderColor Alpha="255" Red="0" Green="0" Blue="0" />
      <VerticalAlignment>Center</VerticalAlignment>
      <HorizontalAlignment>Center</HorizontalAlignment>
    </ImageObject>
    <Bounds X="${MARGIN_LEFT}" Y="${MARGIN_TOP}" Width="${LOGO_WIDTH}" Height="${Math.round(height)}" />
  </ObjectInfo>`;
}

function fitProminent(
  text: string,
  width: number,
  maxHeight: number,
  sizes: number[]
): { text: string; size: number } {
  for (const size of sizes) {
    const wrapped = wrapText(text, size, true, width);
    const lines = wrapped.split('\n').filter(Boolean).length || 1;
    if (lines * lineHeightTwips(size) <= maxHeight) {
      return { text: wrapped, size };
    }
  }
  const size = sizes[sizes.length - 1];
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeightTwips(size)));
  return { text: wrapText(text, size, true, width).split('\n').slice(0, maxLines).join('\n'), size };
}

function labelBands(data: PrescriptionLabelData): { bands: LabelBand[]; headerH: number } {
  const top = MARGIN_TOP;
  const bottom = LABEL_SHORT - MARGIN_BOTTOM;

  const nameText = wrapText(data.practiceName, 7, true, bandWidth(true));
  const addrText = wrapText(`${data.practiceAddress} · Tel ${data.practicePhone}`, 6, false, bandWidth(true));
  const nameH = neededHeight(nameText, 7);
  const addrH = neededHeight(addrText, 6);
  const headerH = nameH + addrH;

  const pet = fitProminent(data.patientName, TEXT_WIDTH, lineHeightTwips(10) * 2, [10, 9]);
  const petH = neededHeight(pet.text, pet.size);
  const metaText = wrapText(ownerMetaLine(data), 7, false, TEXT_WIDTH);
  const metaH = neededHeight(metaText, 7);
  const drug = fitProminent(drugLine(data), TEXT_WIDTH, lineHeightTwips(10) * 2, [11, 10]);
  const drugH = neededHeight(drug.text, drug.size);
  const directionsText = wrapText(data.instructions, DIRECTIONS_POINT_SIZE, true, TEXT_WIDTH)
    .split('\n')
    .filter(Boolean)
    .slice(0, DIRECTIONS_MAX_LINES)
    .join('\n');
  const directionLines = Math.max(1, directionsText.split('\n').filter(Boolean).length);
  const directionsH = lineHeightTwips(DIRECTIONS_POINT_SIZE) * directionLines;
  const footText = wrapText(footerLine(data), 6, false, TEXT_WIDTH);
  const footH = neededHeight(footText, 6);
  const legalText = wrapText(VETERINARY_CAUTION, 5, false, TEXT_WIDTH);
  const legalH = neededHeight(legalText, 5);

  let y = top;
  const nameY = y;
  y += nameH;
  const addrY = y;
  y += addrH;
  const petY = y;
  y += petH;
  const metaY = y;
  y += metaH;
  const drugY = y;
  y += drugH;
  const directionsY = y;
  y += directionsH;
  const stackedFootY = y + 6;
  const stackedLegalY = stackedFootY + footH + 4;
  const fitsStacked = stackedLegalY + legalH <= bottom;
  const legalY = fitsStacked ? stackedLegalY : bottom - legalH;
  const footY = fitsStacked ? stackedFootY : legalY - footH - 4;

  const bands: LabelBand[] = [
    { text: nameText, size: 7, bold: true, inset: true, y: nameY, height: nameH, valign: 'Top' },
    { text: addrText, size: 6, bold: false, inset: true, y: addrY, height: addrH, valign: 'Top' },
    { text: pet.text, size: pet.size, bold: true, y: petY, height: petH, valign: 'Top' },
    { text: metaText, size: 7, bold: false, y: metaY, height: metaH, valign: 'Top' },
    { text: drug.text, size: drug.size, bold: true, y: drugY, height: drugH, valign: 'Top' },
    {
      text: directionsText,
      size: DIRECTIONS_POINT_SIZE,
      bold: true,
      y: directionsY,
      height: directionsH,
      valign: 'Top',
    },
    { text: footText, size: 6, bold: false, y: footY, height: footH, valign: 'Top' },
    { text: legalText, size: 5, bold: false, y: legalY, height: legalH, valign: 'Top' },
  ];

  return { bands: bands.filter((band) => band.text.trim()), headerH };
}

/**
 * DLS label XML for the DYMO 30326 roll (1-4/5" × 3-1/10"), landscape so the long edge
 * runs horizontally.
 *
 * Each block is its own text object rather than one styled run: DYMO concatenates styled
 * elements without honoring the line breaks between them, so mixing font sizes only works
 * across separate objects. Header, pet, drug, and legal stay fixed-size. Directions take
 * the leftover height and wrap across the full width — they shrink only as a last resort,
 * and never scale the rest of the label down with them.
 */
export function buildPrescriptionLabelXml(data: PrescriptionLabelData): string {
  const { bands, headerH } = labelBands(data);
  const objects = [
    logoObjectXml(logoPng(data), headerH),
    ...bands.map((band, index) => textObjectXml(band, index)),
  ];

  const signaturePng = pngFromDataUrl(data.veterinarianSignaturePng);
  if (signaturePng) {
    const sigHeight = 140;
    const sigWidth = 480;
    objects.push(`  <ObjectInfo>
    <ImageObject>
      <Name>Signature</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
      <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <Image>${signaturePng}</Image>
      <ScaleMode>Uniform</ScaleMode>
      <BorderWidth>0</BorderWidth>
      <BorderColor Alpha="255" Red="0" Green="0" Blue="0" />
      <VerticalAlignment>Bottom</VerticalAlignment>
      <HorizontalAlignment>Right</HorizontalAlignment>
    </ImageObject>
    <Bounds X="${LABEL_LONG - MARGIN_RIGHT - sigWidth}" Y="${LABEL_SHORT - MARGIN_BOTTOM - 220 - sigHeight}" Width="${sigWidth}" Height="${sigHeight}" />
  </ObjectInfo>`);
  }

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

/** Notes on the bag / mail-order label. Fits two lines on the 30326 roll. */
export const MAIL_ORDER_BAG_NOTES_MAX = 160;

export type MailOrderBagLabelData = {
  orderNumber: string;
  clientName: string;
  patientName: string;
  notes?: string | null;
};

function buildMailOrderBagLabelXml(data: MailOrderBagLabelData): string {
  const notes = (data.notes || '').trim().slice(0, MAIL_ORDER_BAG_NOTES_MAX);
  const y = MARGIN_TOP;
  const title = wrapText(`Mail order ${data.orderNumber}`, 12, true, TEXT_WIDTH);
  const client = wrapText(data.clientName, 10, true, TEXT_WIDTH);
  const patient = wrapText(data.patientName, 11, true, TEXT_WIDTH);
  const noteText = notes ? wrapText(notes, 8, false, TEXT_WIDTH) : '';
  const titleH = neededHeight(title, 12);
  const clientH = neededHeight(client, 10);
  const patientH = neededHeight(patient, 11);
  const noteH = noteText ? neededHeight(noteText, 8) : 0;
  const bands: LabelBand[] = [
    { text: title, size: 12, bold: true, y, height: titleH },
    { text: client, size: 10, bold: true, y: y + titleH + 20, height: clientH },
    { text: patient, size: 11, bold: true, y: y + titleH + clientH + 40, height: patientH },
  ];
  if (noteText) {
    bands.push({
      text: noteText,
      size: 8,
      bold: false,
      y: y + titleH + clientH + patientH + 70,
      height: noteH,
    });
  }
  const objects = bands.map((band, index) => textObjectXml(band, index));
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

export async function printMailOrderBagLabel(
  printerName: string,
  data: MailOrderBagLabelData,
): Promise<void> {
  const service = await findDymoService();
  const body = new URLSearchParams({
    printerName,
    printParamsXml: '',
    labelXml: buildMailOrderBagLabelXml(data),
    labelSetXml: '',
  });
  const response = await fetch(serviceUrl(service, 'PrintLabel'), { method: 'POST', body });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || 'DYMO could not print the mail-order label.');
  }
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

  const logoBits = pngFromDataUrl(data.practiceLogoPng) ?? VAYD_LABEL_LOGO_PNG_BASE64;
  const logoSrc = `data:image/png;base64,${logoBits}`;
  const body = [
    `<div class="head"><img class="logo" alt="" src="${logoSrc}" /><div><div class="practice">${escapeXml(data.practiceName)}</div><div class="contact">${escapeXml(`${data.practiceAddress} · Tel ${data.practicePhone}`)}</div></div></div>`,
    `<div class="pet">${escapeXml(data.patientName)}</div>`,
    `<div class="meta">${escapeXml(ownerMetaLine(data))}</div>`,
    `<div class="drug">${escapeXml(drugLine(data))}</div>`,
    `<div class="sig">${escapeXml(data.instructions)}</div>`,
    `<div class="foot">${escapeXml(footerLine(data))}</div>`,
    `<div class="legal">${escapeXml(VETERINARY_CAUTION)}</div>`,
  ].join('');

  printWindow.document.write(`<!doctype html>
<html><head><title>Prescription label</title><style>
@page { size: 3.1in 1.8in; margin: 0; }
* { box-sizing: border-box; }
html, body { width: 3.1in; height: 1.8in; margin: 0; }
body { padding: .05in .07in; font: 6.5pt/1.12 Arial, sans-serif; color: #000; overflow: hidden; display: flex; flex-direction: column; }
.head { display: flex; align-items: center; gap: .06in; }
.logo { width: .26in; height: .26in; object-fit: contain; }
.practice { font-size: 7pt; font-weight: 700; }
.contact { font-size: 6pt; }
.pet { font-size: 10pt; font-weight: 700; margin-top: 2pt; }
.meta { font-size: 6.5pt; white-space: pre-wrap; }
.drug { font-size: 11pt; font-weight: 700; margin: 2pt 0; }
.sig { font-size: 8pt; font-weight: 700; flex: 1; white-space: pre-wrap; }
.foot { font-size: 6pt; margin-top: 2pt; }
.legal { font-size: 5pt; }
</style></head><body>${body}<script>window.onload=()=>{window.print();window.close();}</script></body></html>`);
  printWindow.document.close();
}
