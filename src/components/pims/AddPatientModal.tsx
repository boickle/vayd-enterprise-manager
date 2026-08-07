import { FormEvent, useCallback, useEffect, useState } from 'react';
import { createPatientScout, type ScoutPatientWrite } from '../../api/patients';
import { searchClientsStaff, type ClientSearchRow } from '../../api/clientsStaff';
import {
  fetchBreedsForSpeciesPublic,
  fetchSpeciesListPublic,
  type SpeciesBreedsBreed,
  type SpeciesBreedsSpecies,
} from '../../api/speciesBreedsPublic';

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Request failed';
}

function createdPatientId(result: unknown): string | null {
  if (result && typeof result === 'object' && 'id' in (result as object)) {
    const id = (result as { id: unknown }).id;
    if (id != null) return String(id);
  }
  return null;
}

function ownerLabel(row: ClientSearchRow): string {
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  return name || `Client #${row.id}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** Receives the new pet's internal id so the parent can open its detail view. */
  onCreated?: (patientId: string) => void;
};

/**
 * Creates a pet that lives only in Scout (pimsType VAYD). There is no eVet counterpart,
 * so nothing will ever overwrite it.
 */
export default function AddPatientModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [speciesId, setSpeciesId] = useState('');
  const [breedId, setBreedId] = useState('');
  const [sex, setSex] = useState('');
  const [neuterStatus, setNeuterStatus] = useState('');
  const [dob, setDob] = useState('');
  const [color, setColor] = useState('');
  const [weight, setWeight] = useState('');
  const [alerts, setAlerts] = useState('');

  const [owner, setOwner] = useState<{ id: string | number; name: string } | null>(null);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerResults, setOwnerResults] = useState<ClientSearchRow[]>([]);
  const [ownerSearching, setOwnerSearching] = useState(false);

  const [speciesOptions, setSpeciesOptions] = useState<SpeciesBreedsSpecies[]>([]);
  const [breedOptions, setBreedOptions] = useState<SpeciesBreedsBreed[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || speciesOptions.length) return;
    let on = true;
    fetchSpeciesListPublic(DEFAULT_PRACTICE_ID)
      .then((rows) => {
        if (on) setSpeciesOptions(rows);
      })
      .catch(() => {
        if (on) setSpeciesOptions([]);
      });
    return () => {
      on = false;
    };
  }, [open, speciesOptions.length]);

  // Breeds are species-scoped, so the list reloads whenever the species changes.
  useEffect(() => {
    const sid = parseInt(speciesId, 10);
    if (!Number.isFinite(sid)) {
      setBreedOptions([]);
      setBreedId('');
      return;
    }
    let on = true;
    fetchBreedsForSpeciesPublic(DEFAULT_PRACTICE_ID, sid)
      .then((rows) => {
        if (on) setBreedOptions(rows);
      })
      .catch(() => {
        if (on) setBreedOptions([]);
      });
    return () => {
      on = false;
    };
  }, [speciesId]);

  useEffect(() => {
    const term = ownerQuery.trim();
    if (term.length < 2) {
      setOwnerResults([]);
      return;
    }
    let on = true;
    setOwnerSearching(true);
    const timer = setTimeout(() => {
      searchClientsStaff(term)
        .then((rows) => {
          if (on) setOwnerResults(rows.slice(0, 8));
        })
        .catch(() => {
          if (on) setOwnerResults([]);
        })
        .finally(() => {
          if (on) setOwnerSearching(false);
        });
    }, 250);
    return () => {
      on = false;
      clearTimeout(timer);
    };
  }, [ownerQuery]);

  const reset = useCallback(() => {
    setName('');
    setSpeciesId('');
    setBreedId('');
    setSex('');
    setNeuterStatus('');
    setDob('');
    setColor('');
    setWeight('');
    setAlerts('');
    setOwner(null);
    setOwnerQuery('');
    setOwnerResults([]);
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
    const petName = name.trim();
    if (!petName) {
      setError('Pet name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const body: ScoutPatientWrite & { practiceId: number; name: string } = {
      practiceId: DEFAULT_PRACTICE_ID,
      name: petName,
      sex: sex.trim() || null,
      neuterStatus: neuterStatus.trim() || null,
      color: color.trim() || null,
      alerts: alerts.trim() || null,
      // Noon UTC keeps a date-only birthday from shifting a day in either direction.
      dob: dob.trim() ? `${dob.trim()}T12:00:00.000Z` : null,
    };

    const sid = parseInt(speciesId, 10);
    if (Number.isFinite(sid)) body.speciesId = sid;
    const bid = parseInt(breedId, 10);
    if (Number.isFinite(bid)) body.breedId = bid;

    const w = Number(weight.trim());
    if (weight.trim() && Number.isFinite(w)) body.weight = w;

    if (owner) {
      const ownerId = Number(owner.id);
      if (Number.isFinite(ownerId)) body.clientIds = [ownerId];
    }

    try {
      const result = await createPatientScout(body);
      const newId = createdPatientId(result);
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
      <div className="pims-add-client-modal" role="dialog" aria-modal="true" aria-labelledby="pims-add-patient-title">
        <div className="pims-add-client-modal__head">
          <h2 id="pims-add-patient-title">Add patient</h2>
          <button type="button" className="pims-add-client-modal__close" onClick={handleClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className="pims-add-client-modal__form" onSubmit={onSubmit}>
          {error ? <div className="pims-add-client-modal__error">{error}</div> : null}
          <div className="pims-add-client-modal__grid">
            <label className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">Pet name *</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>

            <label>
              <span className="pims-add-client-modal__label">Species</span>
              <select className="input" value={speciesId} onChange={(e) => setSpeciesId(e.target.value)}>
                <option value="">Select species…</option>
                {speciesOptions.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.prettyName || s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="pims-add-client-modal__label">Breed</span>
              <select
                className="input"
                value={breedId}
                onChange={(e) => setBreedId(e.target.value)}
                disabled={!breedOptions.length}
              >
                <option value="">{breedOptions.length ? 'Select breed…' : 'Pick a species first'}</option>
                {breedOptions.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="pims-add-client-modal__label">Sex</span>
              <select className="input" value={sex} onChange={(e) => setSex(e.target.value)}>
                <option value="">Unknown</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </label>
            <label>
              <span className="pims-add-client-modal__label">Spay / neuter</span>
              <select className="input" value={neuterStatus} onChange={(e) => setNeuterStatus(e.target.value)}>
                <option value="">Unknown</option>
                <option value="Intact">Intact</option>
                <option value="Spayed">Spayed</option>
                <option value="Neutered">Neutered</option>
              </select>
            </label>

            <label>
              <span className="pims-add-client-modal__label">Date of birth</span>
              <input className="input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </label>
            <label>
              <span className="pims-add-client-modal__label">Weight (lbs)</span>
              <input
                className="input"
                inputMode="decimal"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </label>
            <label>
              <span className="pims-add-client-modal__label">Color</span>
              <input className="input" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>

            <div className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">Owner</span>
              {owner ? (
                <div className="pims-add-patient__owner-selected">
                  <span>{owner.name}</span>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      setOwner(null);
                      setOwnerQuery('');
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className="input"
                    value={ownerQuery}
                    onChange={(e) => setOwnerQuery(e.target.value)}
                    placeholder="Search clients by name…"
                  />
                  {ownerSearching ? (
                    <p className="pims-add-patient__owner-hint">Searching…</p>
                  ) : ownerResults.length ? (
                    <ul className="pims-add-patient__owner-results">
                      {ownerResults.map((row) => (
                        <li key={String(row.id)}>
                          <button
                            type="button"
                            className="pims-add-patient__owner-option"
                            onClick={() => {
                              setOwner({ id: row.id, name: ownerLabel(row) });
                              setOwnerResults([]);
                            }}
                          >
                            {ownerLabel(row)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : ownerQuery.trim().length >= 2 ? (
                    <p className="pims-add-patient__owner-hint">No matching clients.</p>
                  ) : null}
                </>
              )}
            </div>

            <label className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">Alerts</span>
              <input className="input" value={alerts} onChange={(e) => setAlerts(e.target.value)} />
            </label>
          </div>
          <p className="pims-add-client-modal__hint muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
            Created in Scout only — this pet has no eVet record, so imports will never change it.
            Linking an owner is what lets the pet be booked and routed.
          </p>
          <div className="pims-add-client-modal__actions">
            <button type="button" className="btn secondary" onClick={handleClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save patient'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
