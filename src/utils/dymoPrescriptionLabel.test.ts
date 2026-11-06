import { describe, expect, it } from 'vitest';
import { parseDymoPrinterList } from './dymoPrescriptionLabel';

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
