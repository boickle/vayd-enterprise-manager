/**
 * EMR-07b (owner decision Nov 3, 2026): the prescription history is staff-only. It must never reach
 * the medical-record print, records sent to clients or hospitals, the Rx label or the client portal.
 * The API keeps it out of the record endpoints (integration test EMR-07b-7); this guards the screens
 * that build those outputs from ever pulling it in.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

function filesUnder(rel: string): string[] {
  const dir = join(SRC, rel);
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(join(rel, name)));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(join(rel, name));
  }
  return out;
}

const HISTORY = /recordHistory|RecordHistoryLink|PatientRecordHistory|record-history/;

/** What prints or sends the record, and the Rx label. */
const OUTPUTS = [
  'utils/chartRecordsPdf.ts',
  'utils/householdChartPdfs.ts',
  'utils/patientChartFromMedicalRecord.ts',
  'utils/patientDocuments.ts',
  'utils/dymoPrescriptionLabel.ts',
  'components/pims/ChartRecordsSendBar.tsx',
];

describe('EMR-07b: the prescription history stays off records, labels and the client portal', () => {
  it.each(OUTPUTS)('%s does not use the history', (file) => {
    expect(read(file)).not.toMatch(HISTORY);
  });

  it('the client portal does not use the history', () => {
    const portal = [...filesUnder('pages/clientPortal'), 'pages/ClientPortal.tsx'];
    expect(portal.length).toBeGreaterThan(1);
    for (const file of portal) {
      expect({ file, uses: HISTORY.test(read(file)) }).toEqual({ file, uses: false });
    }
  });

  it('the label print only logs that it printed; the history text is never on the label', () => {
    const print = read('utils/printRxLabel.ts');
    expect(print).toMatch(/recordRxLabelPrinted\(rxNumber\)/);
    expect(print).not.toMatch(/getRecordHistory/);
    expect(read('components/soap/RxLabelModal.tsx')).not.toMatch(
      /getRecordHistory|RecordHistoryLink/
    );
  });

  it('the History link hides itself when printed', () => {
    expect(read('components/records/RecordHistoryLink.css')).toMatch(
      /@media print\s*{\s*\.record-history\s*{\s*display:\s*none/
    );
  });

  // EMR-HIST (owner decision Nov 3, 2026): the pet's History tab, which also lists lab results.
  it('the pet History panel hides itself when printed and only staff see the tab', () => {
    expect(read('components/records/PatientRecordHistoryPanel.tsx')).toMatch(
      /className="record-history patient-record-history"/
    );
    const chart = read('components/pims/PimsPatientDetailView.tsx');
    expect(chart).toMatch(/showRecordHistoryTab \? \(\[\['history', 'History'\]\]/);
    expect(chart).toMatch(/mrTab === 'history' && showRecordHistoryTab/);
  });

  it('the records sent out and the chart print never read the pet history or lab history', () => {
    for (const file of OUTPUTS) {
      expect({ file, uses: /getPatientRecordHistory|lab_result['"]?\s*,\s*entityId/.test(read(file)) }).toEqual({
        file,
        uses: false,
      });
    }
  });
});
