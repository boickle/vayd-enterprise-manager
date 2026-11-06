import { useState } from 'react';
import type { OutsideHospital, OutsideHospitalFields } from '../../api/outsideHospitals';

export type OutsideHospitalFormProps = {
  /** Pass a row to edit it; omit to add a new one. */
  initial?: OutsideHospital | null;
  saving?: boolean;
  submitLabel?: string;
  onSubmit: (fields: OutsideHospitalFields) => void;
  onCancel: () => void;
};

function blank(initial?: OutsideHospital | null): OutsideHospitalFields {
  return {
    name: initial?.name ?? '',
    address: initial?.address ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    notes: initial?.notes ?? '',
  };
}

/**
 * Add or edit one directory entry. Shared by Settings, the Request Records modal,
 * and the records table so a hospital can be created wherever staff notice it missing.
 */
export default function OutsideHospitalForm({
  initial,
  saving = false,
  submitLabel,
  onSubmit,
  onCancel,
}: OutsideHospitalFormProps) {
  const [fields, setFields] = useState<OutsideHospitalFields>(() => blank(initial));

  const patch = (next: Partial<OutsideHospitalFields>) =>
    setFields((current) => ({ ...current, ...next }));

  const nameMissing = !fields.name.trim();

  return (
    <form
      className="outside-hospital-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (nameMissing || saving) return;
        onSubmit({
          name: fields.name.trim(),
          address: fields.address?.trim() || null,
          phone: fields.phone?.trim() || null,
          email: fields.email?.trim().toLowerCase() || null,
          notes: fields.notes?.trim() || null,
        });
      }}
    >
      <div className="outside-hospital-form__grid">
        <label>
          Hospital name
          <input
            className="settings-input"
            value={fields.name}
            autoFocus
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Saco Vet Clinic"
          />
        </label>
        <label>
          Email
          <input
            className="settings-input"
            type="email"
            value={fields.email ?? ''}
            onChange={(e) => patch({ email: e.target.value })}
            placeholder="records@example.com"
          />
        </label>
        <label>
          Phone
          <input
            className="settings-input"
            value={fields.phone ?? ''}
            onChange={(e) => patch({ phone: e.target.value })}
            placeholder="(207) 555-0100"
          />
        </label>
        <label className="outside-hospital-form__wide">
          Address
          <input
            className="settings-input"
            value={fields.address ?? ''}
            onChange={(e) => patch({ address: e.target.value })}
            placeholder="331 North St, Saco, ME 04072"
          />
        </label>
        <label className="outside-hospital-form__wide">
          Notes
          <input
            className="settings-input"
            value={fields.notes ?? ''}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Prefers fax; ask for the records desk"
          />
        </label>
      </div>
      {!fields.email?.trim() ? (
        <p className="settings-muted">
          Without an email we can&rsquo;t send a records request — staff will have to call.
        </p>
      ) : null}
      <div className="outside-hospital-form__actions">
        <button type="submit" className="btn" disabled={nameMissing || saving}>
          {saving ? 'Saving…' : (submitLabel ?? (initial ? 'Save changes' : 'Add hospital'))}
        </button>
        <button type="button" className="btn secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
