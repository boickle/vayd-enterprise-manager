import { describe, expect, it } from 'vitest';
import {
  parseDymoPrinterList,
  printMailOrderBagLabelWithSystemDialog,
  printPrescriptionLabelWithSystemDialog,
  type PrescriptionLabelData,
} from './dymoPrescriptionLabel';

const printersXml = `<Printers>
  <LabelWriterPrinter>
    <Name>DYMO LabelWriter Wireless on DYMOLWW1375A6 2</Name>
    <ModelName>DYMO LabelWriter Wireless</ModelName>
    <IsConnected>True</IsConnected>
    <IsLocal>True</IsLocal>
    <IsTwinTurbo>False</IsTwinTurbo>
  </LabelWriterPrinter>
  <LabelWriterPrinter>
    <Name>DYMO LabelWriter 450 Turbo (Hailey's MacBook Air)</Name>
    <ModelName>DYMO LabelWriter 450 Turbo</ModelName>
    <IsConnected>False</IsConnected>
  </LabelWriterPrinter>
</Printers>`;

describe('parseDymoPrinterList', () => {
  it('reads plain XML', () => {
    expect(parseDymoPrinterList(printersXml)).toEqual([
      {
        name: 'DYMO LabelWriter Wireless on DYMOLWW1375A6 2',
        modelName: 'DYMO LabelWriter Wireless',
        isConnected: true,
      },
      {
        name: "DYMO LabelWriter 450 Turbo (Hailey's MacBook Air)",
        modelName: 'DYMO LabelWriter 450 Turbo',
        isConnected: false,
      },
    ]);
  });

  it('reads XML wrapped in a JSON string', () => {
    const printers = parseDymoPrinterList(JSON.stringify(printersXml));
    expect(printers.map((p) => p.name)).toEqual([
      'DYMO LabelWriter Wireless on DYMOLWW1375A6 2',
      "DYMO LabelWriter 450 Turbo (Hailey's MacBook Air)",
    ]);
  });

  it('reads a printer name with a bare ampersand', () => {
    const xml = `<Printers><LabelWriterPrinter><Name>Front & Back</Name><IsConnected>True</IsConnected></LabelWriterPrinter></Printers>`;
    expect(parseDymoPrinterList(xml)[0]?.name).toBe('Front & Back');
  });

  it('says what DYMO sent when it cannot be read', () => {
    expect(() => parseDymoPrinterList('<Printers><oops')).toThrow(/starts with: <Printers><oops/);
  });
});

function fakePrintWindow() {
  let html = '';
  const win = {
    document: {
      write: (chunk: string) => {
        html += chunk;
      },
      close: () => {},
    },
  } as unknown as Window;
  return { win, html: () => html };
}

const rxLabel: PrescriptionLabelData = {
  practiceName: 'VAYD',
  practiceAddress: '1 Main St',
  practicePhone: '207-555-0100',
  patientName: 'Biscuit',
  species: 'Canine',
  ownerName: 'Pat Owner',
  prescriptionNumber: '1042',
  mailOrderNumber: '#77',
  prescribedDate: '11/7/2026',
  drugName: 'Simparica Trio',
  strength: '24 mg',
  quantity: '3',
  instructions: 'Give 1 treat every 30 days.',
  refills: '0',
  discardAfter: '11/7/2027',
  veterinarianName: 'Dr. Vet',
  veterinarianLicense: 'ME123',
  veterinarianSignaturePng: null,
  practiceLogoPng: null,
};

describe('system print dialog labels', () => {
  it('prints one Rx label page when there is no bag label', () => {
    const fake = fakePrintWindow();
    printPrescriptionLabelWithSystemDialog(rxLabel, fake.win);
    expect(fake.html().match(/<section class="label">/g)).toHaveLength(1);
    expect(fake.html()).toContain('Simparica Trio');
    expect(fake.html()).not.toContain('Mail order #77');
  });

  it('adds the mail-order bag label as page 2 of the same print job', () => {
    const fake = fakePrintWindow();
    printPrescriptionLabelWithSystemDialog(rxLabel, fake.win, {
      orderNumber: '#77',
      clientName: 'Pat Owner',
      patientName: 'Biscuit',
      patientWeight: '42 lb (11/1/2026)',
      notes: 'Ship <cold>',
    });
    const html = fake.html();
    expect(html.match(/<section class="label">/g)).toHaveLength(2);
    expect(html.indexOf('Simparica Trio')).toBeLessThan(html.indexOf('Mail order #77'));
    expect(html).toContain('42 lb (11/1/2026)');
    expect(html).toContain('Ship &lt;cold&gt;');
  });

  it('prints the bag label alone', () => {
    const fake = fakePrintWindow();
    printMailOrderBagLabelWithSystemDialog(
      { orderNumber: '#77', clientName: 'Pat Owner', patientName: 'Biscuit' },
      fake.win,
    );
    expect(fake.html().match(/<section class="label">/g)).toHaveLength(1);
    expect(fake.html()).toContain('Mail order #77');
  });
});
