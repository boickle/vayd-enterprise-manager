import { FormEvent, useCallback, useState } from 'react';
import { createClientScout, type ScoutClientWrite } from '../../api/clientsMutations';

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Request failed';
}

function createdClientId(result: unknown): string | null {
  if (result && typeof result === 'object' && 'id' in (result as object)) {
    const id = (result as { id: unknown }).id;
    if (id != null) return String(id);
  }
  return null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** Receives the new client's internal id so the parent can open its detail view. */
  onCreated?: (clientId: string) => void;
};

/**
 * Creates a client that lives only in Scout (pimsType VAYD). There is no eVet counterpart,
 * so nothing will ever overwrite it.
 */
export default function AddClientModal({ open, onClose, onCreated }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [address1, setAddress1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipcode, setZipcode] = useState('');
  const [alerts, setAlerts] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone1('');
    setPhone2('');
    setAddress1('');
    setCity('');
    setState('');
    setZipcode('');
    setAlerts('');
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (!submitting) {
      reset();
      onClose();
    }
  }, [onClose, reset, submitting]);

  if (!open) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      setError('First and last name are required.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const body: ScoutClientWrite & { practiceId: number; firstName: string } = {
      practiceId: DEFAULT_PRACTICE_ID,
      firstName: fn,
      lastName: ln,
      email: email.trim() || null,
      phone1: phone1.trim() || null,
      phone2: phone2.trim() || null,
      address1: address1.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      zipcode: zipcode.trim() || null,
      alerts: alerts.trim() || null,
    };

    try {
      const result = await createClientScout(body);
      const newId = createdClientId(result);
      reset();
      onClose();
      if (newId && onCreated) onCreated(newId);
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pims-add-client-modal-root" role="presentation">
      <button type="button" className="pims-add-client-modal-backdrop" aria-label="Close" onClick={handleClose} />
      <div className="pims-add-client-modal" role="dialog" aria-modal="true" aria-labelledby="pims-add-client-title">
        <div className="pims-add-client-modal__head">
          <h2 id="pims-add-client-title">Add client</h2>
          <button type="button" className="pims-add-client-modal__close" onClick={handleClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className="pims-add-client-modal__form" onSubmit={onSubmit}>
          {error ? <div className="pims-add-client-modal__error">{error}</div> : null}
          <div className="pims-add-client-modal__grid">
            <label>
              <span className="pims-add-client-modal__label">First name *</span>
              <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </label>
            <label>
              <span className="pims-add-client-modal__label">Last name *</span>
              <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </label>
            <label>
              <span className="pims-add-client-modal__label">Email</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              <span className="pims-add-client-modal__label">Phone</span>
              <input className="input" type="tel" value={phone1} onChange={(e) => setPhone1(e.target.value)} />
            </label>
            <label>
              <span className="pims-add-client-modal__label">Alternate phone</span>
              <input className="input" type="tel" value={phone2} onChange={(e) => setPhone2(e.target.value)} />
            </label>
            <label className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">Address line 1</span>
              <input className="input" value={address1} onChange={(e) => setAddress1(e.target.value)} />
            </label>
            <label>
              <span className="pims-add-client-modal__label">City</span>
              <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <label>
              <span className="pims-add-client-modal__label">State</span>
              <input className="input" value={state} onChange={(e) => setState(e.target.value)} />
            </label>
            <label>
              <span className="pims-add-client-modal__label">ZIP</span>
              <input className="input" value={zipcode} onChange={(e) => setZipcode(e.target.value)} />
            </label>
            <label className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">Alerts</span>
              <input className="input" value={alerts} onChange={(e) => setAlerts(e.target.value)} />
            </label>
          </div>
          <p className="pims-add-client-modal__hint muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
            Created in Scout only — this client has no eVet record, so imports will never change
            it. Add the visit address so routing can geocode the stop.
          </p>
          <div className="pims-add-client-modal__actions">
            <button type="button" className="btn secondary" onClick={handleClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
