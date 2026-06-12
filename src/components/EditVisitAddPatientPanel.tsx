import { useEffect, useMemo, useState } from 'react';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { extractPatientsFromClientPayload } from '../pages/SchedulerBookModal';

export type EditVisitPatientSelection = {
  patientId: string;
  patientLabel: string;
};

type PetRow = {
  id: string | number;
  name: string;
  isActive?: boolean;
  isDeleted?: boolean;
};

type Props = {
  clientId: string;
  clientLabel: string;
  requiresPatient: boolean;
  mode?: 'add' | 'change';
  /** Compact row under the patient card (edit visit header). */
  compact?: boolean;
  /** Current patient on the visit — pre-selected in change mode. */
  initialPatientId?: string | null;
  /** Patient ids already booked for this client in the same time slot. */
  blockedPatientIds?: string[];
  persistedSelection?: EditVisitPatientSelection | null;
  onSelectionChange: (selection: EditVisitPatientSelection | null) => void;
};

export function EditVisitAddPatientPanel({
  clientId,
  clientLabel,
  requiresPatient,
  mode = 'add',
  compact = false,
  initialPatientId = null,
  blockedPatientIds = [],
  persistedSelection = null,
  onSelectionChange,
}: Props) {
  const [clientPets, setClientPets] = useState<PetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatientLabel, setSelectedPatientLabel] = useState('');
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const blockedSet = useMemo(
    () => new Set(blockedPatientIds.map(String)),
    [blockedPatientIds]
  );

  useEffect(() => {
    if (persistedSelection?.patientId?.trim()) {
      setSelectedPatientId(persistedSelection.patientId);
      setSelectedPatientLabel(persistedSelection.patientLabel);
      return;
    }
    if (mode === 'change' && initialPatientId?.trim()) {
      setSelectedPatientId(initialPatientId.trim());
      setSelectedPatientLabel('');
    }
  }, [persistedSelection?.patientId, persistedSelection?.patientLabel, mode, initialPatientId]);

  useEffect(() => {
    const id = clientId.trim();
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchClientByIdStaff(id)
      .then((payload) => {
        if (cancelled) return;
        setClientPets(extractPatientsFromClientPayload(payload));
      })
      .catch(() => {
        if (cancelled) return;
        setClientPets([]);
        setLoadError('Could not load patients for this client.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const activePetChoices = useMemo(
    () =>
      clientPets.filter((p) => {
        if (p.isDeleted === true) return false;
        if (p.isActive === false) return false;
        return true;
      }),
    [clientPets]
  );

  useEffect(() => {
    if (selectedPatientId && !selectedPatientLabel.trim()) {
      const pet = activePetChoices.find((p) => String(p.id) === selectedPatientId);
      if (pet?.name) setSelectedPatientLabel(pet.name);
    }
  }, [selectedPatientId, selectedPatientLabel, activePetChoices]);

  useEffect(() => {
    if (!selectedPatientId?.trim()) {
      setSelectionError(null);
      onSelectionChange(null);
      return;
    }
    if (blockedSet.has(selectedPatientId)) {
      const name = selectedPatientLabel.trim() || 'This patient';
      setSelectionError(
        `${name} is already scheduled for this client at this time. Choose a different patient or reschedule the other visit.`
      );
    } else {
      setSelectionError(null);
    }
    onSelectionChange({
      patientId: selectedPatientId,
      patientLabel: selectedPatientLabel || 'Patient',
    });
  }, [selectedPatientId, selectedPatientLabel, onSelectionChange, blockedSet]);

  const patientLabel = requiresPatient ? 'Patient *' : 'Patient';
  const isChange = mode === 'change';

  const selectField = (
    <>
      {loading ? (
        <p className="scheduler-edit-hint">Loading patients…</p>
      ) : loadError ? (
        <p className="scheduler-edit-error">{loadError}</p>
      ) : activePetChoices.length > 0 ? (
        <label
          className={
            compact
              ? 'scheduler-edit-field scheduler-edit-field--full scheduler-edit-patient-switch-field'
              : 'scheduler-edit-field scheduler-edit-field--full'
          }
        >
          <span>{patientLabel}</span>
          <select
            value={selectedPatientId ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) {
                setSelectedPatientId(null);
                setSelectedPatientLabel('');
                return;
              }
              const pet = activePetChoices.find((p) => String(p.id) === id);
              setSelectedPatientId(id);
              setSelectedPatientLabel(pet?.name ?? 'Patient');
            }}
          >
            {!isChange ? <option value="">Select patient…</option> : null}
            {activePetChoices.map((p) => {
              const id = String(p.id);
              const blocked = blockedSet.has(id);
              return (
                <option key={id} value={id} disabled={blocked}>
                  {p.name}
                  {blocked ? ' (already scheduled at this time)' : ''}
                </option>
              );
            })}
          </select>
          {selectionError ? <p className="scheduler-edit-error">{selectionError}</p> : null}
        </label>
      ) : (
        <p className="scheduler-edit-hint">No active patients on file for this client.</p>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="scheduler-edit-patient-switch" role="region" aria-label="Change patient on visit">
        {selectField}
      </div>
    );
  }

  return (
    <div
      className="scheduler-edit-add-patient"
      role="region"
      aria-label={isChange ? 'Change patient on visit' : 'Add patient to visit'}
    >
      <div className="scheduler-edit-add-patient-head">
        <h3 className="scheduler-edit-add-patient-title">
          {isChange ? 'Patient on this visit' : 'Add patient to this visit'}
        </h3>
        <p className="scheduler-edit-hint scheduler-edit-add-patient-lead">
          {isChange ? (
            <>
              Choose the correct patient for <strong>{clientLabel}</strong>. Pets already booked at
              this time are not available.
            </>
          ) : (
            <>
              This visit is linked to <strong>{clientLabel}</strong> but has no patient yet. Choose a
              patient below, then save.
            </>
          )}
        </p>
      </div>
      {selectField}
    </div>
  );
}
