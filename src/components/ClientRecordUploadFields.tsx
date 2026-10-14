import { useEffect, useRef, useState } from 'react';
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
};

type Delivery = 'upload' | 'request' | 'holdoff' | '';

type Props = {
  delivery: Delivery;
  onDeliveryChange: (value: 'upload' | 'request' | 'holdoff') => void;
  files: PendingClientRecordFile[];
  onFilesChange: (files: PendingClientRecordFile[]) => void;
  pets: ClientRecordPetOption[];
  deliveryError?: string;
  filesError?: string;
  /** Shown under the previous-practice picker (no separate section heading). */
  variant?: 'standalone' | 'combined';
};

function petLabel(pets: ClientRecordPetOption[], formPetId: string): string {
  return pets.find((pet) => pet.id === formPetId)?.name || 'Pet';
}

/** Desktop browsers ignore `capture` and open a file picker instead. */
function deviceOpensCamera(): boolean {
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') return false;
  if (navigator.maxTouchPoints < 1) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

function useCameraCaptureAvailable(): boolean {
  const [available, setAvailable] = useState(deviceOpensCamera);

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => setAvailable(deviceOpensCamera());
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return available;
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
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const canTakePhoto = useCameraCaptureAvailable();
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedPetId, setSelectedPetId] = useState(pets[0]?.id ?? 'pet');
  const activePetId = pets.some((pet) => pet.id === selectedPetId)
    ? selectedPetId
    : pets[0]?.id ?? 'pet';

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

  const combined = variant === 'combined';
  const choiceOptions: {
    value: 'upload' | 'request' | 'holdoff';
    title: string;
    detail: string;
  }[] = [
    {
      value: 'upload',
      title: combined ? "I'll upload them now" : "I'll upload them",
      detail: canTakePhoto
        ? 'Take a photo with your phone, or upload photos or a PDF.'
        : 'Upload photos or a PDF.',
    },
    {
      value: 'request',
      title: 'Please request them',
      detail: combined
        ? 'We will contact the practice(s) listed above to obtain your pet\u2019s prior medical records.'
        : 'We will contact the hospital you listed.',
    },
  ];
  if (combined) {
    choiceOptions.push({
      value: 'holdoff',
      title:
        'Please hold off — I would rather you did not contact these practices for now.',
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
          medications, or vaccine due dates. How should we get records from these practices?{' '}
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
      {deliveryError ? <div className="client-record-upload__error">{deliveryError}</div> : null}

      {delivery === 'upload' ? (
        <div className="client-record-upload__files" data-form-field="recordFiles">
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
