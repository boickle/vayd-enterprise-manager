import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Star, Trash2, Upload, X } from 'lucide-react';
import {
  deletePatientGalleryImage,
  listPatientImages,
  notifyPatientPhotoUpload,
  PATIENT_PHOTO_GALLERY_MAX,
  setPatientImagePrimary,
  uploadPatientGalleryImage,
  type PatientGalleryImage,
} from '../../api/patients';
import { appAlert, appConfirm } from '../../utils/appDialog';
import './PatientPhotoGalleryModal.css';

type Props = {
  open: boolean;
  onClose: () => void;
  patientId: string | number;
  patientName: string;
  /** Called after primary changes so parents can refresh thumbs. */
  onPrimaryChange?: (imageUrl: string | null) => void;
  /**
   * Staff patient page: when Done is clicked after adding photos, offer to
   * email the client (active pets only). Portal should leave this false.
   */
  notifyClientOnUpload?: boolean;
  patientActive?: boolean;
};

const ACCEPT = 'image/jpeg,image/jpg,image/png,image/gif,image/webp';

export default function PatientPhotoGalleryModal({
  open,
  onClose,
  patientId,
  patientName,
  onPrimaryChange,
  notifyClientOnUpload = false,
  patientActive = false,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<PatientGalleryImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | 'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedThisSession, setAddedThisSession] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAddedThisSession(0);
    void listPatientImages(patientId)
      .then((rows) => {
        if (!cancelled) setImages(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load photos.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, patientId]);

  if (!open) return null;

  const atCap = images.length >= PATIENT_PHOTO_GALLERY_MAX;

  async function offerClientNotifyThenClose() {
    if (notifyClientOnUpload && patientActive && addedThisSession > 0) {
      const plural = addedThisSession === 1 ? 'picture' : 'pictures';
      const send = await appConfirm({
        title: 'Email the client?',
        message: `Send ${patientName}'s owner an email letting them know you've added ${
          addedThisSession === 1 ? 'a new picture' : 'new pictures'
        }?`,
        confirmLabel: 'Send email',
        cancelLabel: 'Not now',
      });
      if (send) {
        try {
          const notify = await notifyPatientPhotoUpload(patientId);
          if (!notify.sent) {
            await appAlert({
              title: 'Email not sent',
              message:
                notify.message ||
                `Could not email the client about ${plural === 'picture' ? 'this photo' : 'these photos'}.`,
            });
          }
        } catch (e: unknown) {
          const axiosMsg =
            e &&
            typeof e === 'object' &&
            'response' in e &&
            (e as { response?: { data?: { message?: string | string[] } } })
              .response?.data?.message;
          const detail = Array.isArray(axiosMsg)
            ? axiosMsg.join(', ')
            : typeof axiosMsg === 'string'
              ? axiosMsg
              : e instanceof Error
                ? e.message
                : null;
          await appAlert({
            title: 'Email not sent',
            message:
              detail ||
              `Could not email the client about ${plural === 'picture' ? 'this photo' : 'these photos'}.`,
          });
        }
      }
    }
    onClose();
  }

  async function handleUpload(file: File | null) {
    if (!file || busyId != null) return;
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, GIF, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('The image must be 5 MB or smaller.');
      return;
    }
    if (atCap) {
      setError(`A patient can have at most ${PATIENT_PHOTO_GALLERY_MAX} photos.`);
      return;
    }

    setBusyId('upload');
    setError(null);
    try {
      const result = await uploadPatientGalleryImage(patientId, file);
      setImages(result.images ?? []);
      setAddedThisSession((n) => n + 1);
      onPrimaryChange?.(result.imageUrl ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not upload that photo.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetPrimary(imageId: number) {
    if (busyId != null) return;
    setBusyId(imageId);
    setError(null);
    try {
      const result = await setPatientImagePrimary(patientId, imageId);
      setImages(result.images ?? []);
      onPrimaryChange?.(result.imageUrl ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not set the primary photo.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(imageId: number) {
    if (busyId != null) return;
    const ok = await appConfirm({
      title: 'Delete photo?',
      message: 'This removes the photo permanently.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    setBusyId(imageId);
    setError(null);
    try {
      const result = await deletePatientGalleryImage(patientId, imageId);
      setImages(result.images ?? []);
      onPrimaryChange?.(result.imageUrl || null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete that photo.');
    } finally {
      setBusyId(null);
    }
  }

  return createPortal(
    <div
      className="ppg-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && busyId == null) onClose();
      }}
    >
      <div
        className="ppg-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ppg-title"
      >
        <header className="ppg-modal__head">
          <div>
            <p className="ppg-modal__eyebrow">Pet photos</p>
            <h2 id="ppg-title" className="ppg-modal__title">
              {patientName}
            </h2>
            <p className="ppg-modal__hint">
              Pick a primary photo for charts and the client portal. Up to{' '}
              {PATIENT_PHOTO_GALLERY_MAX} photos.
            </p>
          </div>
          <button
            type="button"
            className="ppg-icon-btn"
            aria-label="Close"
            disabled={busyId != null}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="ppg-modal__body">
          {error ? <div className="ppg-error">{error}</div> : null}
          {loading ? (
            <p className="ppg-muted">Loading photos…</p>
          ) : images.length === 0 ? (
            <div className="ppg-empty">
              <Camera size={28} aria-hidden />
              <p>No photos yet. Upload one to get started.</p>
            </div>
          ) : (
            <ul className="ppg-grid">
              {images.map((img) => {
                const busy = busyId === img.id;
                return (
                  <li
                    key={img.id}
                    className={`ppg-card${img.isPrimary ? ' is-primary' : ''}`}
                  >
                    <img src={img.url} alt="" className="ppg-card__img" />
                    {img.isPrimary ? (
                      <span className="ppg-card__badge">Primary</span>
                    ) : null}
                    <div className="ppg-card__actions">
                      {!img.isPrimary ? (
                        <button
                          type="button"
                          className="ppg-card__btn"
                          disabled={busy || busyId != null}
                          onClick={() => void handleSetPrimary(img.id)}
                          title="Set as primary"
                        >
                          <Star size={14} aria-hidden />
                          Primary
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ppg-card__btn ppg-card__btn--danger"
                        disabled={busy || busyId != null}
                        onClick={() => void handleDelete(img.id)}
                        title="Delete photo"
                      >
                        <Trash2 size={14} aria-hidden />
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="ppg-modal__foot">
          <input
            ref={fileRef}
            className="ppg-file"
            type="file"
            accept={ACCEPT}
            disabled={busyId != null || atCap}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0] ?? null;
              void handleUpload(file);
              e.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            className="ppg-upload"
            disabled={busyId != null || atCap}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={15} aria-hidden />
            {busyId === 'upload' ? 'Uploading…' : atCap ? 'Gallery full' : 'Upload photo'}
          </button>
          <button
            type="button"
            className="ppg-done"
            disabled={busyId != null}
            onClick={() => void offerClientNotifyThenClose()}
          >
            Done
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
