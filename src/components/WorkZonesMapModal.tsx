import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchZonesMap, type ZoneMapFeatureCollection } from '../api/zones';
import '../pages/Scheduler.css';
import './WorkZonesMapModal.css';

type Props = {
  onClose: () => void;
};

/** One distinct color per zone, assigned in name order. */
const ZONE_COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#9a6324',
  '#469990',
  '#800000',
  '#808000',
  '#000075',
  '#bfa600',
  '#dc6b9a',
];

function zoneColor(index: number): string {
  return ZONE_COLORS[index % ZONE_COLORS.length];
}

export function WorkZonesMapModal({ onClose }: Props) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const [zones, setZones] = useState<ZoneMapFeatureCollection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchZonesMap()
      .then((fc) => {
        if (!cancelled) setZones(fc);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the work zones. Try again in a moment.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!zones || !mapEl.current) return;

    const map = L.map(mapEl.current, { zoomSnap: 0.25 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const colorById = new Map<number, string>();
    zones.features.forEach((f, i) => colorById.set(f.properties.id, zoneColor(i)));

    const layer = L.geoJSON(zones, {
      style: (feature) => {
        const color = colorById.get(feature?.properties?.id) ?? '#334155';
        return { color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.25 };
      },
      onEachFeature: (feature, featureLayer) => {
        const p = feature.properties;
        featureLayer.bindPopup(
          `<strong>${escapeHtml(p.name)}</strong><br/>${escapeHtml(p.description ?? '')}`
        );
        featureLayer.on({
          mouseover: (e) => (e.target as L.Path).setStyle({ fillOpacity: 0.45, weight: 3 }),
          mouseout: (e) => layer.resetStyle(e.target as L.Path),
        });
      },
    }).addTo(map);

    for (const f of zones.features) {
      const p = f.properties;
      if (!Number.isFinite(p.labelLat) || !Number.isFinite(p.labelLon)) continue;
      L.marker([p.labelLat, p.labelLon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'work-zones-map-modal__label',
          html: `<span style="border-color:${colorById.get(p.id)}">${escapeHtml(p.name)}</span>`,
          iconSize: undefined,
        }),
      }).addTo(map);
    }

    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16] });
    else map.setView([44.09, -70.18], 8);

    return () => {
      map.remove();
    };
  }, [zones]);

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
          <button
            type="button"
            className="scheduler-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="work-zones-map-modal__body">
          {error ? (
            <div className="work-zones-map-modal__status" role="alert">
              {error}
            </div>
          ) : !zones ? (
            <div className="work-zones-map-modal__status">Loading work zones…</div>
          ) : null}
          {zones ? (
            <>
              <div ref={mapEl} className="work-zones-map-modal__map" />
              <ul className="work-zones-map-modal__legend" aria-label="Zones">
                {zones.features.map((f, i) => (
                  <li key={f.properties.id} title={f.properties.description}>
                    <span
                      className="work-zones-map-modal__swatch"
                      style={{ background: zoneColor(i) }}
                    />
                    {f.properties.description || f.properties.name}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <div className="scheduler-edit-footer work-zones-map-modal__footer">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}
