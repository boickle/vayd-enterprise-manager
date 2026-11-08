import { useRef, useState } from 'react';
import { checkAppointmentRequestRecord } from '../api/clientRecordUploads';
import { useCameraCaptureAvailable } from '../utils/cameraCapture';
import {
  CLIENT_RECORD_MAX_FILES,
  type ClientRecordFileCheck,
  clientRecordFileError,
  clientRecordsVerified,
  petsMissingQualifyingRecords,
  prepareClientRecordFile,
} from '../utils/clientRecordFiles';
import './ClientRecordUploadFields.css';

const CHECK_UNAVAILABLE_MESSAGE =
  "We couldn't check this file right now. Try again in a minute, or choose \"Please request them\" and we'll get the records from your vet.";

function checkErrorMessage(err: unknown): string {
  const ax = err as { response?: { status?: number; data?: { message?: unknown } } };
  const status = ax?.response?.status;
  const msg = ax?.response?.data?.message;
  // 400s carry a message written for the client (wrong format, too large).
  if (status === 400) {
    if (typeof msg === 'string' && msg.trim()) return msg;
    if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0];
  }
  if (status === 429) return 'Too many files checked in a short time. Wait a few minutes and try again.';
  return CHECK_UNAVAILABLE_MESSAGE;
}

export type ClientRecordPetOption = {
  id: string;
  name: string;
  patientId?: number;
};

export type PendingClientRecordFile = {
  localId: string;
  file: File;
  previewUrl: string | null;
  formPetId: string;
  /** Which picked practice these records came from. */
  practiceKey?: string;
  /** Checked when added; only kept files are attached on submit. */
  check: ClientRecordFileCheck;
};

type FilesUpdate = (prev: PendingClientRecordFile[]) => PendingClientRecordFile[];

type Choice = 'upload' | 'request' | 'holdoff';
type Delivery = Choice | '';

export type ClientRecordPracticeOption = { key: string; name: string };

type Props = {
  delivery: Delivery;
  onDeliveryChange: (value: Choice) => void;
  files: PendingClientRecordFile[];
  /** Receives an updater because checks finish after the files are added. */
  onFilesChange: (update: FilesUpdate) => void;
  pets: ClientRecordPetOption[];
  /** Pets that are new patients; each needs a qualifying record to open earlier dates. */
  newPetIds: string[];
  practiceId: number;
  deliveryError?: string;
  filesError?: string;
  /** Shown under the previous-practice picker (no separate section heading). */
  variant?: 'standalone' | 'combined';
  /** Practices the owner picked; with two or more, each gets its own answer. */
  practices?: ClientRecordPracticeOption[];
  practiceDelivery?: Record<string, Choice | undefined>;
  onPracticeDeliveryChange?: (practiceKey: string, value: Choice) => void;
};

const PRACTICE_CHOICES: { value: Choice; label: string }[] = [
  { value: 'request', label: 'Request them' },
  { value: 'upload', label: "I'll upload" },
  { value: 'holdoff', label: "Don't contact" },
];

function petLabel(pets: ClientRecordPetOption[], formPetId: string): string {
  return pets.find((pet) => pet.id === formPetId)?.name || 'Pet';
}

export function ClientRecordUploadFields({
  delivery,
  onDeliveryChange,
  files,
  onFilesChange,
  pets,
  newPetIds,
  practiceId,
  deliveryError,
  filesError,
  variant = 'standalone',
  practices = [],
  practiceDelivery = {},
  onPracticeDeliveryChange,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const canTakePhoto = useCameraCaptureAvailable();
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedPetId, setSelectedPetId] = useState(pets[0]?.id ?? 'pet');
  const activePetId = pets.some((pet) => pet.id === selectedPetId)
    ? selectedPetId
    : pets[0]?.id ?? 'pet';

  const combined = variant === 'combined';
  const perPractice = combined && practices.length > 1 && !!onPracticeDeliveryChange;
  const uploadPractices = perPractice
    ? practices.filter((p) => practiceDelivery[p.key] === 'upload')
    : practices;
  const showUpload = perPractice ? uploadPractices.length > 0 : delivery === 'upload';
  const [selectedPracticeKey, setSelectedPracticeKey] = useState(uploadPractices[0]?.key ?? '');
  const activePracticeKey = uploadPractices.some((p) => p.key === selectedPracticeKey)
    ? selectedPracticeKey
    : uploadPractices[0]?.key;

  const choosePractice = (key: string, value: Choice) => {
    onPracticeDeliveryChange?.(key, value);
    if (value !== 'upload' && files.some((f) => f.practiceKey === key)) {
      for (const f of files) {
        if (f.practiceKey === key && f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      }
      onFilesChange((prev) => prev.filter((f) => f.practiceKey !== key));
    }
  };

  const setCheck = (localId: string, patch: Partial<PendingClientRecordFile>) => {
    onFilesChange((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    );
  };

  const runCheck = async (localId: string, original: File, formPetId: string) => {
    const petName = pets.find((pet) => pet.id === formPetId)?.name?.trim() || '';
    try {
      const file = await prepareClientRecordFile(original);
      const result = await checkAppointmentRequestRecord({
        practiceId,
        file,
        formPetId,
        petName,
      });
      const check: ClientRecordFileCheck =
        result.status !== 'rejected' && result.checkToken
          ? { state: result.status, token: result.checkToken, message: result.message }
          : { state: 'rejected', message: result.message || CHECK_UNAVAILABLE_MESSAGE };
      setCheck(localId, { file, check });
    } catch (err) {
      setCheck(localId, { check: { state: 'rejected', message: checkErrorMessage(err) } });
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const added: PendingClientRecordFile[] = [];
    let error: string | null = null;
    const kept = files.filter((f) => f.check.state !== 'rejected').length;
    for (const file of Array.from(list)) {
      if (kept + added.length >= CLIENT_RECORD_MAX_FILES) {
        error = `You can upload up to ${CLIENT_RECORD_MAX_FILES} files.`;
        break;
      }
      const fileError = clientRecordFileError(file);
      if (fileError) {
        error = fileError;
        continue;
      }
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      added.push({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl,
        formPetId: activePetId,
        practiceKey: activePracticeKey,
        check: { state: 'checking' },
      });
    }
    setLocalError(error);
    if (added.length === 0) return;
    onFilesChange((prev) => [...prev, ...added]);
    for (const item of added) void runCheck(item.localId, item.file, item.formPetId);
  };

  const removeFile = (localId: string) => {
    const target = files.find((file) => file.localId === localId);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    onFilesChange((prev) => prev.filter((file) => file.localId !== localId));
  };

  const photoHint = canTakePhoto
    ? 'Take a photo with your phone, or upload photos or a PDF.'
    : 'Upload photos or a PDF.';
  const choiceOptions: {
    value: Choice;
    title: string;
    detail: string;
  }[] = [
    {
      value: 'request',
      title: 'Please request them for me',
      detail: combined
        ? 'We\u2019ll email the practice today for your pet\u2019s prior medical records.'
        : 'We will contact the hospital you listed.',
    },
    {
      value: 'upload',
      title: combined ? 'I have them and will upload them now' : "I'll upload them",
      detail: combined ? `We won\u2019t contact the practice. ${photoHint}` : photoHint,
    },
  ];
  if (combined) {
    choiceOptions.push({
      value: 'holdoff',
      title: 'Don\u2019t contact them for now',
      detail: 'You can always ask us later.',
    });
  }

  const checking = files.some((f) => f.check.state === 'checking');
  const hasKept = files.some((f) => f.check.state === 'qualifies' || f.check.state === 'accepted');
  const verified = clientRecordsVerified(files, newPetIds);
  const missingPetNames = petsMissingQualifyingRecords(files, newPetIds).map((id) =>
    petLabel(pets, id),
  );

  return (
    <div
      className={
        combined
          ? 'client-record-upload client-record-upload--combined'
          : 'client-record-upload'
      }
      data-form-field="recordsDelivery"
    >
      {combined ? (
        <p className="client-record-upload__hint client-record-upload__hint--combined">
          Having their history before the visit means we are not guessing at past illnesses,
          medications, or vaccine due dates.{' '}
          {perPractice
            ? 'For each practice, should we request the records, or will you upload them?'
            : 'How should we get records from this practice?'}{' '}
          <span style={{ color: '#ef4444' }}>*</span>
        </p>
      ) : (
        <>
          <span className="client-record-upload__label">
            How should we get your pet&apos;s records? <span style={{ color: '#ef4444' }}>*</span>
          </span>
          <p className="client-record-upload__hint">
            Uploading photos or a PDF yourself can get your pet seen sooner. You can also ask us to
            request them from the previous hospital.
          </p>
        </>
      )}
      {perPractice ? (
        <div className="client-record-upload__practices">
          {practices.map((practice) => (
            <div key={practice.key} className="client-record-upload__practice">
              <span className="client-record-upload__practice-name">{practice.name}</span>
              <div
                className="client-record-upload__practice-choices"
                role="radiogroup"
                aria-label={`Records from ${practice.name}`}
              >
                {PRACTICE_CHOICES.map((choice) => {
                  const selected = practiceDelivery[practice.key] === choice.value;
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={
                        selected
                          ? 'client-record-upload__practice-choice client-record-upload__practice-choice--selected'
                          : 'client-record-upload__practice-choice'
                      }
                      onClick={() => choosePractice(practice.key, choice.value)}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="client-record-upload__hint" style={{ margin: 0 }}>
            We only contact the practices marked &ldquo;Request them.&rdquo;
          </p>
        </div>
      ) : (
      <div className="client-record-upload__choices">
        {choiceOptions.map((option) => (
          <label
            key={option.value}
            className={
              delivery === option.value
                ? 'client-record-upload__choice client-record-upload__choice--selected'
                : 'client-record-upload__choice'
            }
          >
            <input
              type="radio"
              name="recordsDelivery"
              value={option.value}
              checked={delivery === option.value}
              onChange={() => onDeliveryChange(option.value)}
            />
            <span>
              <span className="client-record-upload__choice-title">{option.title}</span>
              <span className="client-record-upload__choice-detail">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>
      )}
      {deliveryError ? <div className="client-record-upload__error">{deliveryError}</div> : null}

      {showUpload ? (
        <div className="client-record-upload__files" data-form-field="recordFiles">
          {perPractice && uploadPractices.length > 1 ? (
            <label className="client-record-upload__pet">
              These records are from
              <select
                value={activePracticeKey}
                onChange={(e) => setSelectedPracticeKey(e.target.value)}
              >
                {uploadPractices.map((practice) => (
                  <option key={practice.key} value={practice.key}>
                    {practice.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {pets.length > 1 ? (
            <label className="client-record-upload__pet">
              These records are for
              <select value={activePetId} onChange={(e) => setSelectedPetId(e.target.value)}>
                {pets.map((pet) => (
                  <option key={pet.id} value={pet.id}>
                    {pet.name || 'Pet'}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="client-record-upload__actions">
            {canTakePhoto ? (
              <button
                type="button"
                className="client-record-upload__btn"
                onClick={() => cameraRef.current?.click()}
              >
                Take a photo
              </button>
            ) : null}
            <button
              type="button"
              className="client-record-upload__btn"
              onClick={() => libraryRef.current?.click()}
            >
              Upload photos or PDF
            </button>
          </div>
          {canTakePhoto ? (
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          ) : null}
          <input
            ref={libraryRef}
            type="file"
            accept="image/*,application/pdf,.heic,.heif"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {files.length > 0 ? (
            <ul className="client-record-upload__list">
              {files.map((item) => (
                <li key={item.localId} className="client-record-upload__file">
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt="" className="client-record-upload__thumb" />
                  ) : (
                    <span className="client-record-upload__thumb" aria-hidden />
                  )}
                  <span className="client-record-upload__file-meta">
                    <span className="client-record-upload__file-name">{item.file.name}</span>
                    <span className="client-record-upload__file-pet">
                      {petLabel(pets, item.formPetId)}
                      {perPractice && uploadPractices.length > 1 && item.practiceKey
                        ? ` · ${practices.find((p) => p.key === item.practiceKey)?.name ?? ''}`
                        : ''}
                    </span>
                    <span
                      className={`client-record-upload__check client-record-upload__check--${item.check.state}`}
                      role="status"
                    >
                      {item.check.state === 'checking'
                        ? 'Checking this file…'
                        : item.check.state === 'rejected'
                          ? `Not added. ${item.check.message}`
                          : item.check.message}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="client-record-upload__remove"
                    onClick={() => removeFile(item.localId)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="client-record-upload__hint" style={{ marginTop: 10, marginBottom: 0 }}>
              Add the records from your vet&apos;s office, such as the vaccine history or visit notes. Photos of printed pages are fine, and you can add more than one page. Invoices and notes you wrote yourself can&apos;t be used.
            </p>
          )}
          {files.length > 0 && !checking ? (
            verified ? (
              <p className="client-record-upload__summary client-record-upload__summary--ok">
                Your records look good. Earlier appointment times are open.
              </p>
            ) : hasKept && missingPetNames.length > 0 ? (
              <p className="client-record-upload__summary">
                Earlier appointment times open once each pet has a record from their vet that shows
                vaccine or visit history with dates. Still needed for: {missingPetNames.join(', ')}.
              </p>
            ) : !hasKept ? (
              <p className="client-record-upload__summary">
                We need records from your vet&apos;s office, such as the vaccine history or visit
                notes. Invoices and notes you wrote yourself can&apos;t be used. If you don&apos;t
                have them, choose &quot;Please request them&quot; and we&apos;ll ask your vet.
              </p>
            ) : null
          ) : null}
          {localError || filesError ? (
            <div className="client-record-upload__error">{filesError || localError}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
