import { useEffect, useState } from 'react';
import {
  listPatientPrescriptions,
  listProblems,
  VISIT_WORKFLOW_PRACTICE_ID,
  type PatientPrescription,
  type PatientProblem,
} from '../../api/visitWorkflow';
import type { VisitWrapUpPet } from '../../api/visitWrapUp';
import {
  readSoapChronicDraft,
  writeSoapChronicDraft,
  type SoapChronicDraft,
} from '../../utils/soapChronicDraft';
import SoapPatientChronicSummary from './SoapPatientChronicSummary';

type PetReview = {
  patientId: number;
  patientName: string;
  encounterId: string;
  locked: boolean;
  problems: PatientProblem[];
  medications: PatientPrescription[];
  draft: SoapChronicDraft;
};

export default function WrapUpChronicReview({
  pets,
}: {
  pets: VisitWrapUpPet[];
}) {
  const [rows, setRows] = useState<PetReview[]>([]);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      const next = await Promise.all(
        pets.map(async (pet) => {
          const [problems, meds] = await Promise.all([
            listProblems(pet.patientId).catch(() => [] as PatientProblem[]),
            listPatientPrescriptions(pet.patientId, { activeChronicOnly: true }).catch(
              () => [] as PatientPrescription[],
            ),
          ]);
          return {
            patientId: pet.patientId,
            patientName: pet.patientName,
            encounterId: pet.soapEncounterId,
            locked: pet.status === 'completed',
            problems,
            medications: meds,
            draft: readSoapChronicDraft(pet.soapEncounterId),
          };
        }),
      );
      if (!canceled) setRows(next);
    })();
    return () => {
      canceled = true;
    };
  }, [pets]);

  const patchDraft = (encounterId: string, draft: SoapChronicDraft) => {
    writeSoapChronicDraft(encounterId, draft);
    setRows((prev) =>
      prev.map((row) => (row.encounterId === encounterId ? { ...row, draft } : row)),
    );
  };

  if (rows.length === 0) return null;

  return (
    <section className="soap-wrapup-section">
      <h2>
        <span className="soap-wrapup-step">2</span> Chronic problems &amp; medications
      </h2>
      {rows.map((pet) => (
        <div className="soap-wrapup-chronic" key={pet.patientId}>
          <strong>{pet.patientName}</strong>
          <SoapPatientChronicSummary
            patientId={pet.patientId}
            practiceId={VISIT_WORKFLOW_PRACTICE_ID}
            encounterId={pet.encounterId}
            problems={pet.problems}
            chronicMedications={pet.medications}
            draft={pet.draft}
            disabled={pet.locked}
            variant="wrapup"
            onDraftChange={(draft) => patchDraft(pet.encounterId, draft)}
            onProblemSaved={(updated) =>
              setRows((prev) =>
                prev.map((row) =>
                  row.patientId === pet.patientId
                    ? {
                        ...row,
                        problems: row.problems.map((p) => (p.id === updated.id ? updated : p)),
                      }
                    : row,
                ),
              )
            }
            onProblemRemoved={(id) =>
              setRows((prev) =>
                prev.map((row) =>
                  row.patientId === pet.patientId
                    ? { ...row, problems: row.problems.filter((p) => p.id !== id) }
                    : row,
                ),
              )
            }
          />
        </div>
      ))}
    </section>
  );
}
