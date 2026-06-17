import { createPortal } from 'react-dom';
import { WORK_ZONES_MAP_EMBED_URL, WORK_ZONES_MAP_URL } from '../constants/workZonesMap';
import '../pages/Scheduler.css';
import './WorkZonesMapModal.css';

type Props = {
  onClose: () => void;
};

export function WorkZonesMapModal({ onClose }: Props) {
  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="scheduler-modal work-zones-map-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-zones-map-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Reference</p>
            <h2 id="work-zones-map-title">Work Zones Map</h2>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="work-zones-map-modal__body">
          <iframe
            className="work-zones-map-modal__frame"
            title="Work Zones Revised map"
            src={WORK_ZONES_MAP_EMBED_URL}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>

        <div className="scheduler-edit-footer work-zones-map-modal__footer">
          <a
            className="btn secondary"
            href={WORK_ZONES_MAP_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Google Maps
          </a>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
