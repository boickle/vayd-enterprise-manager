import { useRef, useState } from 'react';
import { useCameraCaptureAvailable } from '../utils/cameraCapture';
import {
  CLIENT_RECORD_MAX_FILES,
  clientRecordFileError,
} from '../utils/clientRecordFiles';
import './ClientRecordUploadFields.css';

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
};

type Choice = 'upload' | 'request' | 'holdoff';
type Delivery = Choice | '';

export type ClientRecordPracticeOption = { key: string; name: string };

type Props = {
  delivery: Delivery;
  onDeliveryChange: (value: Choice) => void;
  files: PendingClientRecordFile[];
  onFilesChange: (files: PendingClientRecordFile[]) => void;
  pets: ClientRecordPetOption[];
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
      onFilesChange(files.filter((f) => f.practiceKey !== key));
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files];
    let error: string | null = null;
    for (const file of Array.from(list)) {
      if (next.length >= CLIENT_RECORD_MAX_FILES) {
        error = `You can upload up to ${CLIENT_RECORD_MAX_FILES} files.`;
        break;
      }
      const fileError = clientRecordFileError(file);
      if (fileError) {
        error = fileError;
        continue;
      }
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      next.push({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl,
        formPetId: activePetId,
        practiceKey: activePracticeKey,
      });
    }
    setLocalError(error);
    onFilesChange(next);
  };

  const removeFile = (localId: string) => {
    const target = files.find((file) => file.localId === localId);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    onFilesChange(files.filter((file) => file.localId !== localId));
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
              Photos of paper records are fine. You can add more than one page.
            </p>
          )}
          {localError || filesError ? (
            <div className="client-record-upload__error">{filesError || localError}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
