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
  persistedSelection?: EditVisitPatientSelection | null;
  onSelectionChange: (selection: EditVisitPatientSelection | null) => void;
};

export function EditVisitAddPatientPanel({
  clientId,
  clientLabel,
  requiresPatient,
  persistedSelection = null,
  onSelectionChange,
}: Props) {
  const [clientPets, setClientPets] = useState<PetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatientLabel, setSelectedPatientLabel] = useState('');

  useEffect(() => {
    if (!persistedSelection?.patientId?.trim()) return;
    setSelectedPatientId(persistedSelection.patientId);
    setSelectedPatientLabel(persistedSelection.patientLabel);
  }, [persistedSelection?.patientId, persistedSelection?.patientLabel]);

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
    if (!selectedPatientId?.trim()) {
      onSelectionChange(null);
      return;
    }
    onSelectionChange({
      patientId: selectedPatientId,
      patientLabel: selectedPatientLabel || 'Patient',
    });
  }, [selectedPatientId, selectedPatientLabel, onSelectionChange]);

  const patientLabel = requiresPatient ? 'Patient *' : 'Patient';

  return (
    <div className="scheduler-edit-add-patient" role="region" aria-label="Add patient to visit">
      <div className="scheduler-edit-add-patient-head">
        <h3 className="scheduler-edit-add-patient-title">Add patient to this visit</h3>
        <p className="scheduler-edit-hint scheduler-edit-add-patient-lead">
          This visit is linked to <strong>{clientLabel}</strong> but has no patient yet. Choose a
          patient below, then save.
        </p>
      </div>
      {loading ? (
        <p className="scheduler-edit-hint">Loading patients…</p>
      ) : loadError ? (
        <p className="scheduler-edit-error">{loadError}</p>
      ) : activePetChoices.length > 0 ? (
        <label className="scheduler-edit-field scheduler-edit-field--full">
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
            <option value="">Select patient…</option>
            {activePetChoices.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="scheduler-edit-hint">No active patients on file for this client.</p>
      )}
    </div>
  );
}
