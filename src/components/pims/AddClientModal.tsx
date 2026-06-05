import { FormEvent, useCallback, useMemo, useState } from 'react';
import { upsertClients, saveClients, type ClientDto } from '../../api/clientsMutations';

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Request failed';
}

function firstSavedClientId(result: unknown): string | null {
  if (result == null) return null;
  if (Array.isArray(result)) {
    const first = result[0] as Record<string, unknown> | undefined;
    if (first && first.id != null) return String(first.id);
    return null;
  }
  if (typeof result === 'object' && 'id' in (result as object)) {
    const id = (result as { id: unknown }).id;
    if (id != null) return String(id);
  }
  return null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** After POST /clients save — internal id when API returns it */
  onCreated?: (clientId: string) => void;
  /** After POST /clients/upsert — no id in response; parent can search by last name */
  onUpserted?: (lastNameForSearch: string) => void;
};

export default function AddClientModal({ open, onClose, onCreated, onUpserted }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [pimsId, setPimsId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address1, setAddress1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const practice = useMemo(() => ({ id: DEFAULT_PRACTICE_ID }), []);

  const reset = useCallback(() => {
    setFirstName('');
    setLastName('');
    setPimsId('');
    setEmail('');
    setPhone('');
    setAddress1('');
    setCity('');
    setState('');
    setZip('');
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
    const dto: ClientDto = {
      firstName: fn,
      lastName: ln,
      practice,
    };
    const pid = pimsId.trim();
    if (pid) dto.pimsId = pid;
    const em = email.trim();
    if (em) dto.email = em;
    const ph = phone.trim();
    if (ph) {
      dto.phones = [{ number: ph, label: 'Mobile' }];
      dto.mobilePhone = ph;
    }
    const a1 = address1.trim();
    if (a1) dto.address1 = a1;
    const c = city.trim();
    if (c) dto.city = c;
    const st = state.trim();
    if (st) dto.state = st;
    const z = zip.trim();
    if (z) dto.zip = z;
    dto.isActive = true;
    dto.isDeleted = false;

    try {
      if (pid) {
        await upsertClients(dto);
        const lnSearch = ln;
        reset();
        onClose();
        onUpserted?.(lnSearch);
      } else {
        const result = await saveClients(dto);
        const newId = firstSavedClientId(result);
        reset();
        onClose();
        if (newId && onCreated) onCreated(newId);
      }
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
            <label className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">PIMS ID (optional)</span>
              <input
                className="input"
                value={pimsId}
                onChange={(e) => setPimsId(e.target.value)}
                placeholder="External / PIMS client id — uses upsert when set"
              />
            </label>
            <label>
              <span className="pims-add-client-modal__label">Email</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              <span className="pims-add-client-modal__label">Phone</span>
              <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
              <input className="input" value={zip} onChange={(e) => setZip(e.target.value)} />
            </label>
          </div>
          <p className="pims-add-client-modal__hint muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
            Practice is taken from your JWT / env default ({DEFAULT_PRACTICE_ID}). With a PIMS ID, the client is{' '}
            <strong>upserted</strong> (importer conflict key). Without PIMS ID, a new row is <strong>saved</strong> via{' '}
            <code>POST /clients</code>.
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
