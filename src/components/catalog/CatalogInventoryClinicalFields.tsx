import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  patchPracticeInventoryItem,
  type InventoryVaccineDetails,
} from '../../api/inventoryTools';
import type { InventoryItem } from '../../api/quantityPriceBreaks';

type Props = {
  practiceId: number;
  item: InventoryItem;
  onSaved: () => void;
};

type ClinicalDraft = {
  manufacturer: string;
  vendorName: string;
  vendorDrugNumber: string;
  barcode: string;
  defaultQuantity: string;
  isMedication: boolean;
  requireExpirationOnLots: boolean;
  trackLots: boolean;
  isVaccine: boolean;
  dispenseNote: string;
  isControlled: boolean;
  isMicrochip: boolean;
  hasClientNotes: boolean;
  clientNote: string;
  hideOnInvoice: boolean;
  hideOnMedicalRecordView: boolean;
  hideOnMedicalRecordPrint: boolean;
  excludeFromProduction: boolean;
  allowPriceChange: boolean;
  changePatientStatusTo: string;
  changePatientSex: boolean;
};

type VaccineDraft = {
  name: string;
  manufacturer: string;
  vaccineType: string;
  dosageType: string;
  createRabiesCertificate: boolean;
  createVaccinationLog: boolean;
  usdaLicensingMonths: string;
  animalControlLicensingMonths: string;
  tagIssuePeriodMonths: string;
  defaultSerial: string;
};

const VACCINE_TYPES = [
  'Live',
  'Modified Live',
  'Killed',
  'Recombinant',
  'RNA',
  'Other',
];

const FLAG_HELP: Record<string, string> = {
  isMedication:
    'Something you prescribe or hand to the client. The SOAP opens Dose & Rx (directions, refills, start date), it goes on the prescription history, and the directions below prefill the label.',
  isVaccine:
    'Marks this as a vaccine so SOAP captures dose details and lot when administered.',
  isControlled: 'Controlled substance — track carefully for DEA / state reporting.',
  isMicrochip:
    'When charged on a visit, staff must enter the microchip number. It is saved on the patient and shown next to their name.',
  trackLots: 'Enable lot / serial balances by branch. Required for vaccine lot picking on SOAP.',
  requireExpirationOnLots: 'A lot cannot be saved without an expiration date.',
  hasClientNotes:
    'Show a client-facing note on this charge. Set the default below; staff can edit it on the SOAP and at checkout.',
  hideOnInvoice: 'Hide this line on the client invoice.',
  hideOnMedicalRecordView: 'Hide this line when viewing the medical record on screen.',
  hideOnMedicalRecordPrint: 'Hide this line when printing the medical record.',
  excludeFromProduction:
    'Revenue still counts for the practice, but it is not attributed to a provider’s VSD — it lands in Not Specified.',
  allowPriceChange:
    'Staff may change the unit price of this line on the SOAP / at checkout.',
  changePatientSex: 'Charging this item updates the patient’s sex (e.g. after spay/neuter).',
};

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function strField(v: unknown): string {
  return v == null ? '' : String(v);
}

function fromItem(item: InventoryItem): ClinicalDraft {
  return {
    manufacturer: strField(item.manufacturer),
    vendorName: strField(item.vendorName),
    vendorDrugNumber: strField(item.vendorDrugNumber),
    barcode: strField(item.barcode),
    defaultQuantity: strField(item.defaultQuantity),
    // eVet imports can mark an item dispensable without marking it a medication; both mean
    // "prescribed product" here, so either one checks the single Medication box and keeps
    // the saved directions visible instead of silently dropping them.
    isMedication: item.isMedication === true || item.isDispensable === true,
    requireExpirationOnLots: item.requireExpirationOnLots === true,
    trackLots: item.trackLots === true,
    isVaccine: item.isVaccine === true,
    dispenseNote: strField(item.dispenseNote),
    isControlled: item.isControlled === true,
    isMicrochip: item.isMicrochip === true,
    hasClientNotes: item.hasClientNotes === true,
    clientNote: strField(item.clientNote),
    hideOnInvoice: item.hideOnInvoice === true,
    hideOnMedicalRecordView: item.hideOnMedicalRecordView === true,
    hideOnMedicalRecordPrint: item.hideOnMedicalRecordPrint === true,
    excludeFromProduction: item.excludeFromProduction === true,
    allowPriceChange: item.allowPriceChange === true,
    changePatientStatusTo: strField(item.changePatientStatusTo),
    changePatientSex: item.changePatientSex === true,
  };
}

function vaccineFromItem(item: InventoryItem): VaccineDraft {
  const d = (item.vaccineDetails ?? {}) as InventoryVaccineDetails;
  return {
    name: strField(d.name ?? item.name),
    manufacturer: strField(d.manufacturer ?? item.manufacturer),
    vaccineType: strField(d.vaccineType),
    dosageType: strField(d.dosageType),
    createRabiesCertificate: d.createRabiesCertificate === true,
    createVaccinationLog: d.createVaccinationLog !== false,
    usdaLicensingMonths: strField(d.usdaLicensingMonths),
    animalControlLicensingMonths: strField(d.animalControlLicensingMonths),
    tagIssuePeriodMonths: strField(d.tagIssuePeriodMonths),
    defaultSerial: strField(d.defaultSerial),
  };
}

/**
 * A button rather than a span: interactive descendants suppress the surrounding
 * label's activation, so reading the hint never toggles the checkbox.
 */
const TOOLTIP_WIDTH = 260;

/**
 * A button rather than a span: interactive descendants suppress the surrounding
 * label's activation, so reading the hint never toggles the checkbox. The bubble
 * is fixed-positioned off the trigger rect so modal overflow can't clip it.
 */
function FlagHelp({ text }: { text: string }) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - 8)),
    });
  };
  const hide = () => setPos(null);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={text}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pos) hide();
          else show();
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          padding: 0,
          marginLeft: 6,
          borderRadius: '50%',
          border: '1px solid #94a3b8',
          background: 'transparent',
          color: '#64748b',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'help',
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        ?
      </button>
      {pos && (
        <span
          role="tooltip"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: TOOLTIP_WIDTH,
            padding: '8px 10px',
            borderRadius: 6,
            background: '#0f172a',
            color: '#f8fafc',
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.45,
            whiteSpace: 'normal',
            boxShadow: '0 6px 20px rgba(15, 23, 42, 0.25)',
            zIndex: 4000,
            pointerEvents: 'none',
          }}
        >
          {text}
        </span>
      )}
    </>
  );
}

const NOTE_TEXTAREA_STYLE = {
  display: 'block',
  width: '100%',
  maxWidth: 'none',
  marginTop: 6,
  resize: 'vertical',
} as const;

function FlagCheckbox({
  checked,
  label,
  help,
  onChange,
}: {
  checked: boolean;
  label: string;
  help?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-checkbox-item" style={{ alignItems: 'flex-start' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
        {label}
        {help ? <FlagHelp text={help} /> : null}
      </span>
    </label>
  );
}

function summaryChips(draft: ClinicalDraft): string[] {
  const chips: string[] = [];
  if (draft.isMedication) chips.push('Medication');
  if (draft.isVaccine) chips.push('Vaccine');
  if (draft.trackLots) chips.push('Lots');
  if (draft.requireExpirationOnLots) chips.push('Lot expiration required');
  if (draft.isControlled) chips.push('Controlled');
  if (draft.isMicrochip) chips.push('Microchip');
  if (draft.hasClientNotes) chips.push('Client notes');
  if (draft.allowPriceChange) chips.push('Price editable');
  if (draft.excludeFromProduction) chips.push('Excluded from provider VSD');
  if (draft.hideOnInvoice) chips.push('Hidden on invoice');
  return chips;
}

export default function CatalogInventoryClinicalFields({
  practiceId,
  item,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<ClinicalDraft>(() => fromItem(item));
  const [vaccineDraft, setVaccineDraft] = useState<VaccineDraft>(() =>
    vaccineFromItem(item)
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(fromItem(item));
    setVaccineDraft(vaccineFromItem(item));
  }, [item]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await patchPracticeInventoryItem(practiceId, item.id, {
        manufacturer: draft.manufacturer.trim() || null,
        vendorName: draft.vendorName.trim() || null,
        vendorDrugNumber: draft.vendorDrugNumber.trim() || null,
        barcode: draft.barcode.trim() || null,
        defaultQuantity: numOrNull(draft.defaultQuantity),
        isMedication: draft.isMedication,
        requireExpirationOnLots: draft.requireExpirationOnLots,
        trackLots: draft.trackLots,
        isVaccine: draft.isVaccine,
        // Dispensable is no longer a separate switch: a medication is what you hand to a
        // client, and the directions below are its label text.
        isDispensable: draft.isMedication,
        dispenseNote: draft.isMedication
          ? draft.dispenseNote.trim() || null
          : null,
        isControlled: draft.isControlled,
        isMicrochip: draft.isMicrochip,
        hasClientNotes: draft.hasClientNotes,
        clientNote: draft.hasClientNotes ? draft.clientNote.trim() || null : null,
        hideOnInvoice: draft.hideOnInvoice,
        hideOnMedicalRecordView: draft.hideOnMedicalRecordView,
        hideOnMedicalRecordPrint: draft.hideOnMedicalRecordPrint,
        excludeFromProduction: draft.excludeFromProduction,
        allowPriceChange: draft.allowPriceChange,
        changePatientStatusTo: draft.changePatientStatusTo.trim() || null,
        changePatientSex: draft.changePatientSex,
        ...(draft.isVaccine
          ? {
              vaccineDetails: {
                name: vaccineDraft.name.trim() || null,
                manufacturer: vaccineDraft.manufacturer.trim() || null,
                vaccineType: vaccineDraft.vaccineType || null,
                dosageType: vaccineDraft.dosageType || null,
                createRabiesCertificate: vaccineDraft.createRabiesCertificate,
                createVaccinationLog: vaccineDraft.createVaccinationLog,
                usdaLicensingMonths: numOrNull(vaccineDraft.usdaLicensingMonths),
                animalControlLicensingMonths: numOrNull(
                  vaccineDraft.animalControlLicensingMonths
                ),
                tagIssuePeriodMonths: numOrNull(vaccineDraft.tagIssuePeriodMonths),
                defaultSerial: vaccineDraft.defaultSerial.trim() || null,
              } satisfies InventoryVaccineDetails,
            }
          : {}),
      });
      setDetailsOpen(false);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save item details');
    } finally {
      setSaving(false);
    }
  }

  const chips = summaryChips(fromItem(item));
  const savedDraft = fromItem(item);

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <h4 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
          Supply &amp; clinical flags
        </h4>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            setError(null);
            setDraft(fromItem(item));
            setDetailsOpen(true);
          }}
        >
          Edit details
        </button>
      </div>
      <p className="settings-muted" style={{ marginBottom: 10, fontSize: 13 }}>
        Manufacturer, vendor, lot tracking, and how this item behaves on a SOAP.
        Values sync from eVet when available; saving here stops eVet from overwriting them.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 8,
          marginBottom: 10,
          fontSize: 13,
        }}
      >
        <SummaryField label="Manufacturer" value={savedDraft.manufacturer} />
        <SummaryField label="Vendor" value={savedDraft.vendorName} />
        <SummaryField label="Default qty" value={savedDraft.defaultQuantity} />
        <SummaryField
          label="Barcode"
          value={savedDraft.barcode}
        />
      </div>

      {chips.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {chips.map((c) => (
            <span
              key={c}
              style={{
                fontSize: 12,
                padding: '3px 8px',
                borderRadius: 6,
                background: '#f1f5f9',
                color: '#334155',
              }}
            >
              {c}
            </span>
          ))}
        </div>
      ) : (
        <p className="settings-muted" style={{ fontSize: 13, marginBottom: 10 }}>
          No clinical flags set yet.
        </p>
      )}

      {detailsOpen && (
        <ModalShell
          title="Edit supply & clinical details"
          onClose={() => setDetailsOpen(false)}
          width={640}
        >
          {error && (
            <div
              className="settings-message settings-error-message"
              style={{ marginBottom: 10 }}
            >
              {error}
            </div>
          )}

          <SectionTitle>Supply</SectionTitle>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 10,
              marginBottom: 16,
            }}
          >
            {(
              [
                ['manufacturer', 'Manufacturer'],
                ['vendorName', 'Vendor'],
                ['vendorDrugNumber', 'Vendor drug #'],
                ['barcode', 'Barcode'],
                ['defaultQuantity', 'Default qty'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="settings-label">
                {label}
                <input
                  className="settings-input"
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>

          <SectionTitle>Medication</SectionTitle>
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 12,
              background: '#f8fafc',
              marginBottom: 16,
            }}
          >
            <FlagCheckbox
              checked={draft.isMedication}
              label="Medication"
              help={FLAG_HELP.isMedication}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, isMedication: checked }))
              }
            />
            <p className="settings-muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
              Opens Dose &amp; Rx on the SOAP and adds it to the patient’s prescription
              history.
            </p>
            {draft.isMedication && (
              <label className="settings-label" style={{ margin: '12px 0 0' }}>
                Default directions
                <FlagHelp text="Prefills the directions (sig) on the SOAP and the dispensing label. Staff can edit them per patient." />
                <textarea
                  className="settings-input"
                  rows={3}
                  value={draft.dispenseNote}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, dispenseNote: e.target.value }))
                  }
                  placeholder="e.g. Give 1 tablet by mouth every 12 hours with food"
                  style={NOTE_TEXTAREA_STYLE}
                />
              </label>
            )}
          </div>

          <SectionTitle>Vaccine</SectionTitle>
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 12,
              background: '#f8fafc',
              marginBottom: 16,
            }}
          >
            <FlagCheckbox
              checked={draft.isVaccine}
              label="Vaccine"
              help={FLAG_HELP.isVaccine}
              onChange={(checked) =>
                setDraft((d) => ({
                  ...d,
                  isVaccine: checked,
                  ...(checked ? { trackLots: true } : {}),
                }))
              }
            />
            {draft.isVaccine && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 10,
                  margin: '12px 0 0',
                }}
              >
                <label className="settings-label" style={{ gridColumn: '1 / -1' }}>
                  Name
                  <input
                    className="settings-input"
                    value={vaccineDraft.name}
                    onChange={(e) =>
                      setVaccineDraft((d) => ({ ...d, name: e.target.value }))
                    }
                  />
                </label>
                <label className="settings-label">
                  Manufacturer
                  <input
                    className="settings-input"
                    value={vaccineDraft.manufacturer}
                    onChange={(e) =>
                      setVaccineDraft((d) => ({ ...d, manufacturer: e.target.value }))
                    }
                  />
                </label>
                <label className="settings-label">
                  Vaccine type
                  <select
                    className="settings-input"
                    value={vaccineDraft.vaccineType}
                    onChange={(e) =>
                      setVaccineDraft((d) => ({ ...d, vaccineType: e.target.value }))
                    }
                  >
                    <option value="">—</option>
                    {(VACCINE_TYPES.includes(vaccineDraft.vaccineType) ||
                    !vaccineDraft.vaccineType
                      ? VACCINE_TYPES
                      : [...VACCINE_TYPES, vaccineDraft.vaccineType]
                    ).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-label">
                  Dosage type
                  <select
                    className="settings-input"
                    value={vaccineDraft.dosageType}
                    onChange={(e) =>
                      setVaccineDraft((d) => ({ ...d, dosageType: e.target.value }))
                    }
                  >
                    <option value="">—</option>
                    <option value="initial">Initial</option>
                    <option value="booster">Booster</option>
                  </select>
                </label>
                <label className="settings-label">
                  Default serial (optional)
                  <input
                    className="settings-input"
                    value={vaccineDraft.defaultSerial}
                    onChange={(e) =>
                      setVaccineDraft((d) => ({ ...d, defaultSerial: e.target.value }))
                    }
                  />
                </label>
                <label className="settings-label">
                  USDA licensing (months)
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    value={vaccineDraft.usdaLicensingMonths}
                    onChange={(e) =>
                      setVaccineDraft((d) => ({
                        ...d,
                        usdaLicensingMonths: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="settings-label">
                  Animal control licensing (months)
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    value={vaccineDraft.animalControlLicensingMonths}
                    onChange={(e) =>
                      setVaccineDraft((d) => ({
                        ...d,
                        animalControlLicensingMonths: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="settings-label">
                  Tag issue period (months)
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    value={vaccineDraft.tagIssuePeriodMonths}
                    onChange={(e) =>
                      setVaccineDraft((d) => ({
                        ...d,
                        tagIssuePeriodMonths: e.target.value,
                      }))
                    }
                  />
                </label>
                <label
                  className="settings-checkbox-item"
                  style={{ gridColumn: '1 / -1' }}
                >
                  <input
                    type="checkbox"
                    checked={vaccineDraft.createRabiesCertificate}
                    onChange={(e) =>
                      setVaccineDraft((d) => ({
                        ...d,
                        createRabiesCertificate: e.target.checked,
                      }))
                    }
                  />
                  <span>Create rabies certificate</span>
                </label>
                <label
                  className="settings-checkbox-item"
                  style={{ gridColumn: '1 / -1' }}
                >
                  <input
                    type="checkbox"
                    checked={vaccineDraft.createVaccinationLog}
                    onChange={(e) =>
                      setVaccineDraft((d) => ({
                        ...d,
                        createVaccinationLog: e.target.checked,
                      }))
                    }
                  />
                  <span>Create vaccination log</span>
                </label>
              </div>
            )}
          </div>

          <SectionTitle>Other clinical behavior</SectionTitle>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <FlagCheckbox
              checked={draft.isControlled}
              label="Controlled"
              help={FLAG_HELP.isControlled}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, isControlled: checked }))
              }
            />
            <FlagCheckbox
              checked={draft.isMicrochip}
              label="Microchip"
              help={FLAG_HELP.isMicrochip}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, isMicrochip: checked }))
              }
            />
            <FlagCheckbox
              checked={draft.trackLots}
              label="Lots enabled"
              help={FLAG_HELP.trackLots}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, trackLots: checked }))
              }
            />
            <FlagCheckbox
              checked={draft.requireExpirationOnLots}
              label="Require expiration on lots"
              help={FLAG_HELP.requireExpirationOnLots}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, requireExpirationOnLots: checked }))
              }
            />
            <FlagCheckbox
              checked={draft.hasClientNotes}
              label="Has client notes"
              help={FLAG_HELP.hasClientNotes}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, hasClientNotes: checked }))
              }
            />
            <FlagCheckbox
              checked={draft.allowPriceChange}
              label="Allow price change"
              help={FLAG_HELP.allowPriceChange}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, allowPriceChange: checked }))
              }
            />
            <FlagCheckbox
              checked={draft.excludeFromProduction}
              label="Exclude from production"
              help={FLAG_HELP.excludeFromProduction}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, excludeFromProduction: checked }))
              }
            />
            <FlagCheckbox
              checked={draft.hideOnInvoice}
              label="Hide on invoice"
              help={FLAG_HELP.hideOnInvoice}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, hideOnInvoice: checked }))
              }
            />
            <FlagCheckbox
              checked={draft.hideOnMedicalRecordView}
              label="Hide on medical record view"
              help={FLAG_HELP.hideOnMedicalRecordView}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, hideOnMedicalRecordView: checked }))
              }
            />
            <FlagCheckbox
              checked={draft.hideOnMedicalRecordPrint}
              label="Hide on medical record print"
              help={FLAG_HELP.hideOnMedicalRecordPrint}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, hideOnMedicalRecordPrint: checked }))
              }
            />
            <FlagCheckbox
              checked={draft.changePatientSex}
              label="Change patient sex"
              help={FLAG_HELP.changePatientSex}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, changePatientSex: checked }))
              }
            />
          </div>

          {draft.hasClientNotes && (
            <label className="settings-label" style={{ marginBottom: 12 }}>
              Default client note
              <FlagHelp text="Shown on the charge line for the client; editable on SOAP / checkout." />
              <textarea
                className="settings-input"
                rows={3}
                value={draft.clientNote}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, clientNote: e.target.value }))
                }
                placeholder="e.g. Care instructions for home"
                style={NOTE_TEXTAREA_STYLE}
              />
            </label>
          )}

          <label className="settings-label" style={{ maxWidth: 320, marginBottom: 16 }}>
            Change patient status to
            <input
              className="settings-input"
              value={draft.changePatientStatusTo}
              onChange={(e) =>
                setDraft((d) => ({ ...d, changePatientStatusTo: e.target.value }))
              }
              placeholder="Optional (e.g. Euthanized)"
            />
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn"
              onClick={() => setDetailsOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </ModalShell>
      )}

    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="settings-muted" style={{ fontSize: 11, marginBottom: 2 }}>
        {label}
      </div>
      <div>{value.trim() ? value : '—'}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h5 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>{children}</h5>
  );
}

function ModalShell({
  title,
  onClose,
  width,
  children,
}: {
  title: string;
  onClose: () => void;
  width: number;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 10,
          padding: 20,
          width: `min(${width}px, 100%)`,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 12px 40px rgba(15,23,42,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 14px', fontSize: 17 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
