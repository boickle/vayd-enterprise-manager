import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAllAppointmentTypes,
  type AppointmentType,
} from '../api/appointmentSettings';
import {
  defaultRoutingOfferableScoreConfig,
  fetchRoutingOfferableScoreThresholds,
  saveRoutingOfferableScoreThresholds,
  type RoutingOfferableScoreConfig,
} from '../api/routingOfferableScoreThresholds';
import {
  OFFERABLE_SCORE_DAY_BUCKETS,
  OFFERABLE_SCORE_DAY_BUCKET_HINTS,
  OFFERABLE_SCORE_DAY_BUCKET_LABELS,
  type OfferableScoreDayBucket,
  type OfferableScoreThresholdsByBucket,
} from '../utils/routingOfferableScoreConfig';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function extractErr(err: unknown): string {
  const e = err as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

function typeLabel(type: AppointmentType): string {
  return type.prettyName?.trim() || type.name?.trim() || `Type #${type.id}`;
}

function parseOptionalScore(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

export default function RoutingScoreThresholdsPage() {
  const [config, setConfig] = useState<RoutingOfferableScoreConfig>(
    defaultRoutingOfferableScoreConfig,
  );
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    kind: 'success' | 'error';
  } | null>(null);
  const [typeFilter, setTypeFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [thresholds, appointmentTypes] = await Promise.all([
        fetchRoutingOfferableScoreThresholds(PRACTICE_ID),
        fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: true }),
      ]);
      setConfig(thresholds);
      setTypes(
        appointmentTypes
          .filter((t) => !t.isDeleted && t.isActive !== false)
          .sort((a, b) => typeLabel(a).localeCompare(typeLabel(b))),
      );
    } catch (err) {
      setLoadError(extractErr(err));
      setConfig(defaultRoutingOfferableScoreConfig());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredTypes = useMemo(() => {
    const q = typeFilter.trim().toLowerCase();
    if (!q) return types;
    return types.filter((t) => {
      const label = typeLabel(t).toLowerCase();
      const name = (t.name || '').toLowerCase();
      return label.includes(q) || name.includes(q) || String(t.id).includes(q);
    });
  }, [types, typeFilter]);

  const setDefaultBucket = (bucket: OfferableScoreDayBucket, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    setConfig((prev) => ({
      ...prev,
      defaults: { ...prev.defaults, [bucket]: Math.round(n) },
    }));
  };

  const setTypeBucket = (
    typeId: number,
    bucket: OfferableScoreDayBucket,
    raw: string,
  ) => {
    const key = String(typeId);
    const parsed = parseOptionalScore(raw);
    setConfig((prev) => {
      const existing: OfferableScoreThresholdsByBucket = {
        ...(prev.byAppointmentTypeId[key] ?? {}),
      };
      if (parsed == null) {
        delete existing[bucket];
      } else {
        existing[bucket] = parsed;
      }
      const nextByType = { ...prev.byAppointmentTypeId };
      if (Object.keys(existing).length === 0) {
        delete nextByType[key];
      } else {
        nextByType[key] = existing;
      }
      return { ...prev, byAppointmentTypeId: nextByType };
    });
  };

  const clearTypeOverrides = (typeId: number) => {
    const key = String(typeId);
    setConfig((prev) => {
      if (!prev.byAppointmentTypeId[key]) return prev;
      const nextByType = { ...prev.byAppointmentTypeId };
      delete nextByType[key];
      return { ...prev, byAppointmentTypeId: nextByType };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveRoutingOfferableScoreThresholds(PRACTICE_ID, config);
      setConfig(saved);
      setMessage({ text: 'Routing score thresholds saved.', kind: 'success' });
    } catch (err) {
      setMessage({ text: extractErr(err), kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page" style={{ padding: '1.5rem 1.75rem' }}>
      <div className="settings-header" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Routing score thresholds</h2>
        <p className="settings-section-description" style={{ marginTop: 8, maxWidth: 720 }}>
          Control the maximum routing score for slots offered on the appointment
          request form. Lower scores are better fits. Raise the same-day (or
          near-term) ceilings to fill open books. Appointment types leave a
          bucket blank to inherit the global default.
        </p>
      </div>

      {message && (
        <div
          className={
            message.kind === 'success'
              ? 'settings-message settings-success-message'
              : 'settings-message settings-error-message'
          }
        >
          {message.text}
          <button
            type="button"
            className="settings-close"
            onClick={() => setMessage(null)}
          >
            ×
          </button>
        </div>
      )}

      {loadError && (
        <div className="settings-message settings-error-message">
          {loadError}
          <button type="button" className="settings-close" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="settings-loading">
          <div className="settings-spinner" />
          <span>Loading thresholds…</span>
        </div>
      ) : (
        <>
          <section className="settings-section" style={{ marginBottom: 28 }}>
            <h3 style={{ marginTop: 0 }}>Global defaults</h3>
            <p className="settings-section-description" style={{ marginTop: 0 }}>
              Used when an appointment type does not set its own value for that
              proximity bucket.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 12,
                maxWidth: 800,
              }}
            >
              {OFFERABLE_SCORE_DAY_BUCKETS.map((bucket) => (
                <div key={bucket} className="settings-form-group">
                  <label className="settings-label">
                    {OFFERABLE_SCORE_DAY_BUCKET_LABELS[bucket]}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="settings-input"
                    value={config.defaults[bucket]}
                    title={OFFERABLE_SCORE_DAY_BUCKET_HINTS[bucket]}
                    onChange={(e) => setDefaultBucket(bucket, e.target.value)}
                  />
                </div>
              ))}
              <div className="settings-form-group">
                <label className="settings-label">Member bonus</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="settings-input"
                  value={config.memberBonus}
                  title="Added to the resolved threshold for member-tier online booking"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n) || n < 0) return;
                    setConfig((prev) => ({
                      ...prev,
                      memberBonus: Math.round(n),
                    }));
                  }}
                />
              </div>
            </div>
          </section>

          <section className="settings-section" style={{ marginBottom: 28 }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <h3 style={{ margin: 0 }}>By appointment type</h3>
              <input
                type="search"
                className="settings-input"
                placeholder="Filter types…"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={{ maxWidth: 240 }}
              />
            </div>
            <p className="settings-section-description" style={{ marginTop: 0 }}>
              Leave a cell blank to use the global default for that bucket.
              Placeholder text shows the current default.
            </p>

            <div style={{ overflowX: 'auto' }}>
              <table className="settings-table" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Appointment type</th>
                    {OFFERABLE_SCORE_DAY_BUCKETS.map((bucket) => (
                      <th key={bucket} title={OFFERABLE_SCORE_DAY_BUCKET_HINTS[bucket]}>
                        {OFFERABLE_SCORE_DAY_BUCKET_LABELS[bucket]}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredTypes.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ opacity: 0.7 }}>
                        No appointment types match.
                      </td>
                    </tr>
                  ) : (
                    filteredTypes.map((type) => {
                      const key = String(type.id);
                      const overrides = config.byAppointmentTypeId[key] ?? {};
                      const hasOverrides = Object.keys(overrides).length > 0;
                      return (
                        <tr key={type.id}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{typeLabel(type)}</div>
                            <div style={{ fontSize: 12, opacity: 0.65 }}>
                              #{type.id}
                              {type.showInApptRequestForm ? ' · request form' : ''}
                              {type.allowOnlineBooking ? ' · online booking' : ''}
                            </div>
                          </td>
                          {OFFERABLE_SCORE_DAY_BUCKETS.map((bucket) => (
                            <td key={bucket}>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="settings-input"
                                style={{ width: 88 }}
                                placeholder={String(config.defaults[bucket])}
                                value={
                                  overrides[bucket] != null
                                    ? String(overrides[bucket])
                                    : ''
                                }
                                onChange={(e) =>
                                  setTypeBucket(type.id, bucket, e.target.value)
                                }
                              />
                            </td>
                          ))}
                          <td>
                            {hasOverrides ? (
                              <button
                                type="button"
                                className="settings-btn"
                                onClick={() => clearTypeOverrides(type.id)}
                              >
                                Clear
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <button
            type="button"
            className="settings-btn settings-btn-primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save thresholds'}
          </button>
        </>
      )}
    </div>
  );
}
