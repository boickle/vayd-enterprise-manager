import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import {
  fetchZonesMap,
  fetchZonesMapDoctors,
  type ZoneMapDoctor,
  type ZoneMapFeatureCollection,
  type ZoneMapProperties,
} from '../api/zones';
import '../pages/Scheduler.css';
import './WorkZonesMapModal.css';

type Props = {
  onClose: () => void;
};

type ZoneFeature = Feature<Polygon | MultiPolygon, ZoneMapProperties>;

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

/** One distinct color per doctor, assigned in list order. */
const DOCTOR_COLORS = [
  '#d81b60',
  '#1e88e5',
  '#43a047',
  '#fb8c00',
  '#8e24aa',
  '#00897b',
  '#6d4c41',
  '#3949ab',
  '#c0ca33',
  '#e53935',
];

/** All zones, drawn quietly under the selected doctors' zones. */
const MUTED_ZONE_COLOR = '#64748b';

function zoneColor(index: number): string {
  return ZONE_COLORS[index % ZONE_COLORS.length];
}

function doctorColor(index: number): string {
  return DOCTOR_COLORS[index % DOCTOR_COLORS.length];
}

function zoneRoleLabel(isPrimary: boolean): string {
  return isPrimary ? 'Primary' : 'Backup';
}

export function WorkZonesMapModal({ onClose }: Props) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  const [zones, setZones] = useState<ZoneMapFeatureCollection | null>(null);
  const [doctors, setDoctors] = useState<ZoneMapDoctor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [doctorsError, setDoctorsError] = useState<string | null>(null);
  const [showAllZones, setShowAllZones] = useState(true);
  const [selectedDoctorIds, setSelectedDoctorIds] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchZonesMap()
      .then((fc) => {
        if (!cancelled) setZones(fc);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the work zones. Try again in a moment.');
      });
    fetchZonesMapDoctors()
      .then((list) => {
        if (!cancelled) setDoctors(list);
      })
      .catch(() => {
        if (!cancelled) setDoctorsError('Could not load the doctors. The zones still show.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const featureById = useMemo(() => {
    const m = new Map<number, ZoneFeature>();
    for (const f of zones?.features ?? []) m.set(f.properties.id, f);
    return m;
  }, [zones]);

  const zoneColorById = useMemo(() => {
    const m = new Map<number, string>();
    (zones?.features ?? []).forEach((f, i) => m.set(f.properties.id, zoneColor(i)));
    return m;
  }, [zones]);

  const doctorColorById = useMemo(() => {
    const m = new Map<number, string>();
    doctors.forEach((d, i) => m.set(d.employeeId, doctorColor(i)));
    return m;
  }, [doctors]);

  const selectedDoctors = useMemo(
    () => doctors.filter((d) => selectedDoctorIds.includes(d.employeeId)),
    [doctors, selectedDoctorIds]
  );

  // Create the map once the zones have loaded.
  useEffect(() => {
    if (!zones || !mapEl.current) return;

    const map = L.map(mapEl.current, { zoomSnap: 0.25 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    overlayRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const bounds = L.geoJSON(zones).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16] });
    else map.setView([44.09, -70.18], 8);

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [zones]);

  // Redraw the zones and labels whenever the selection changes.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!zones || !overlay) return;
    overlay.clearLayers();

    const anyDoctor = selectedDoctors.length > 0;
    const labelText = new Map<number, string>();

    if (showAllZones) {
      const allLayer: L.GeoJSON = L.geoJSON(zones, {
        style: (feature) => {
          const color = anyDoctor
            ? MUTED_ZONE_COLOR
            : (zoneColorById.get(feature?.properties?.id) ?? MUTED_ZONE_COLOR);
          return anyDoctor
            ? { color, weight: 1, opacity: 0.6, fillColor: color, fillOpacity: 0.06 }
            : { color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.25 };
        },
        onEachFeature: (feature, layer) => {
          const p = feature.properties as ZoneMapProperties;
          layer.bindPopup(
            `<strong>${escapeHtml(p.name)}</strong><br/>${escapeHtml(p.description ?? '')}`
          );
          if (!anyDoctor) {
            layer.on({
              mouseover: (e) => (e.target as L.Path).setStyle({ fillOpacity: 0.45, weight: 3 }),
              mouseout: (e) => allLayer.resetStyle(e.target as L.Path),
            });
          }
        },
      });
      allLayer.addTo(overlay);
      for (const f of zones.features) labelText.set(f.properties.id, f.properties.name);
    }

    // Backups first, so each doctor's primary zone draws on top.
    for (const doc of selectedDoctors) {
      const color = doctorColorById.get(doc.employeeId) ?? MUTED_ZONE_COLOR;
      const ordered = [...doc.zones].sort((a, b) => Number(a.isPrimary) - Number(b.isPrimary));
      for (const z of ordered) {
        const feature = featureById.get(z.zoneId);
        if (!feature) continue;
        L.geoJSON(feature, {
          style: z.isPrimary
            ? { color, weight: 3, opacity: 1, fillColor: color, fillOpacity: 0.35 }
            : {
                color,
                weight: 2,
                opacity: 0.9,
                dashArray: '6 5',
                fillColor: color,
                fillOpacity: 0.12,
              },
        })
          .bindPopup(
            `<strong>${escapeHtml(z.name)} (${zoneRoleLabel(z.isPrimary)})</strong><br/>${escapeHtml(doc.name)}`
          )
          .addTo(overlay);

        const role = selectedDoctors.length === 1 ? ` · ${zoneRoleLabel(z.isPrimary)}` : '';
        labelText.set(z.zoneId, `${z.name}${role}`);
      }
    }

    for (const [zoneId, text] of labelText) {
      const p = featureById.get(zoneId)?.properties;
      if (!p || !Number.isFinite(p.labelLat) || !Number.isFinite(p.labelLon)) continue;
      const border = anyDoctor ? MUTED_ZONE_COLOR : (zoneColorById.get(zoneId) ?? MUTED_ZONE_COLOR);
      const docColor =
        selectedDoctors.length === 1
          ? selectedDoctors[0].zones.some((z) => z.zoneId === zoneId)
            ? doctorColorById.get(selectedDoctors[0].employeeId)
            : undefined
          : undefined;
      L.marker([p.labelLat, p.labelLon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'work-zones-map-modal__label',
          html: `<span style="border-color:${docColor ?? border}">${escapeHtml(text)}</span>`,
          iconSize: undefined,
        }),
      }).addTo(overlay);
    }
  }, [zones, showAllZones, selectedDoctors, featureById, zoneColorById, doctorColorById]);

  function fitToZones(zoneIds: number[]) {
    const map = mapRef.current;
    if (!map) return;
    const features = zoneIds
      .map((id) => featureById.get(id))
      .filter((f): f is ZoneFeature => f != null);
    if (features.length === 0) return;
    const collection: ZoneMapFeatureCollection = { type: 'FeatureCollection', features };
    const bounds = L.geoJSON(collection).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
  }

  function toggleDoctor(doc: ZoneMapDoctor, checked: boolean) {
    setSelectedDoctorIds((prev) =>
      checked
        ? [...prev.filter((id) => id !== doc.employeeId), doc.employeeId]
        : prev.filter((id) => id !== doc.employeeId)
    );
    if (checked) fitToZones(doc.zones.map((z) => z.zoneId));
  }

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
          ) : (
            <div className="work-zones-map-modal__layout">
              <aside className="work-zones-map-modal__panel" aria-label="Map layers">
                <label className="work-zones-map-modal__layer">
                  <input
                    type="checkbox"
                    checked={showAllZones}
                    onChange={(e) => setShowAllZones(e.target.checked)}
                  />
                  <span className="work-zones-map-modal__layer-name">All zones</span>
                  <span className="work-zones-map-modal__muted">{zones.features.length}</span>
                </label>

                <h3 className="work-zones-map-modal__heading">Doctors</h3>
                {doctorsError ? (
                  <p className="work-zones-map-modal__muted" role="alert">
                    {doctorsError}
                  </p>
                ) : doctors.length === 0 ? (
                  <p className="work-zones-map-modal__muted">No doctors have zones yet.</p>
                ) : (
                  <ul className="work-zones-map-modal__doctors">
                    {doctors.map((doc) => {
                      const checked = selectedDoctorIds.includes(doc.employeeId);
                      const color = doctorColorById.get(doc.employeeId);
                      return (
                        <li key={doc.employeeId}>
                          <label className="work-zones-map-modal__layer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => toggleDoctor(doc, e.target.checked)}
                            />
                            <span
                              className="work-zones-map-modal__swatch"
                              style={{ background: color }}
                              aria-hidden="true"
                            />
                            <span className="work-zones-map-modal__layer-name">{doc.name}</span>
                          </label>
                          {checked ? (
                            <ul className="work-zones-map-modal__doctor-zones">
                              {doc.primaryZoneId == null ? (
                                <li className="work-zones-map-modal__muted">No primary zone set</li>
                              ) : null}
                              {doc.zones.map((z) => (
                                <li key={z.zoneId}>
                                  <button
                                    type="button"
                                    className="work-zones-map-modal__zone-link"
                                    onClick={() => fitToZones([z.zoneId])}
                                    title={`Zoom to ${z.name}`}
                                  >
                                    <span
                                      className={
                                        z.isPrimary
                                          ? 'work-zones-map-modal__zone-mark is-primary'
                                          : 'work-zones-map-modal__zone-mark'
                                      }
                                      style={{
                                        borderColor: color,
                                        background: z.isPrimary ? color : undefined,
                                      }}
                                      aria-hidden="true"
                                    />
                                    {z.name} ({zoneRoleLabel(z.isPrimary)})
                                  </button>
                                  {!z.acceptingNewPatients || z.transitioningOutOfZone ? (
                                    <span className="work-zones-map-modal__zone-note">
                                      {[
                                        !z.acceptingNewPatients ? 'not taking new patients' : null,
                                        z.transitioningOutOfZone ? 'transitioning out' : null,
                                      ]
                                        .filter(Boolean)
                                        .join(', ')}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </aside>
              <div ref={mapEl} className="work-zones-map-modal__map" />
            </div>
          )}
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
