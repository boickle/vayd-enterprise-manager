import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAllAppointmentTypes, type AppointmentType } from '../api/appointmentSettings';
import {
  defaultRoutingOfferableScoreConfig,
  fetchRoutingOfferableScoreThresholds,
  fetchRoutingScoreCalibration,
  saveRoutingOfferableScoreThresholds,
  type RoutingOfferableScoreConfig,
  type RoutingScoreCalibrationResponse,
} from '../api/routingOfferableScoreThresholds';
import {
  OFFERABLE_SCORE_DAY_BUCKETS,
  OFFERABLE_SCORE_DAY_BUCKET_HINTS,
  OFFERABLE_SCORE_DAY_BUCKET_LABELS,
  parsePercentile,
  percentileForScore,
  resolveConfigFromPercentiles,
  scoreAtPercentile,
  type OfferableScoreDayBucket,
  type OfferableScorePercentilesByBucket,
  type OfferableScoreThresholdsByBucket,
} from '../utils/routingOfferableScoreConfig';
import './Settings.css';
import './RoutingScoreThresholds.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

const WINDOW_OPTIONS = [30, 60, 90, 180] as const;

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

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return 'never';
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Plain-language read of what a percentage setting means for clients. */
function qualityWord(pct: number): string {
  if (pct <= 25) return 'Very strict';
  if (pct <= 45) return 'Strict';
  if (pct <= 65) return 'Balanced';
  if (pct <= 85) return 'Loose';
  return 'Very loose';
}

export default function RoutingScoreThresholdsPage() {
  const [config, setConfig] = useState<RoutingOfferableScoreConfig>(
    defaultRoutingOfferableScoreConfig
  );
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [windowDays, setWindowDays] = useState<number>(90);
  const [preview, setPreview] = useState<RoutingScoreCalibrationResponse | null>(null);
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
          .sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)))
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

  const calibration = config.calibration;
  const calibrated = calibration != null;

  const filteredTypes = useMemo(() => {
    const q = typeFilter.trim().toLowerCase();
    if (!q) return types;
    return types.filter((t) => {
      const label = typeLabel(t).toLowerCase();
      const name = (t.name || '').toLowerCase();
      return label.includes(q) || name.includes(q) || String(t.id).includes(q);
    });
  }, [types, typeFilter]);

  /**
   * Percentage shown for a bucket: the stored slider position, or where the
   * saved score lands on the curve for a config that predates calibration.
   */
  const bucketPercent = useCallback(
    (bucket: OfferableScoreDayBucket): number | null => {
      const stored = config.percentiles[bucket];
      if (stored != null) return stored;
      return percentileForScore(calibration, config.defaults[bucket]);
    },
    [config, calibration]
  );

  /**
   * Adopt a fresh curve. Buckets with no slider position yet are seeded from
   * where they already sit on the new curve, so calibrating on its own never
   * changes who gets offered what — it only makes the setting legible.
   */
  const applyCalibration = (result: RoutingScoreCalibrationResponse) => {
    setConfig((prev) => {
      const percentiles: OfferableScorePercentilesByBucket = {
        ...prev.percentiles,
      };
      for (const bucket of OFFERABLE_SCORE_DAY_BUCKETS) {
        if (percentiles[bucket] == null) {
          const seeded =
            result.currentPercentiles[bucket] ??
            percentileForScore(result.calibration, prev.defaults[bucket]);
          if (seeded != null) percentiles[bucket] = Math.max(1, seeded);
        }
      }
      return resolveConfigFromPercentiles({
        ...prev,
        percentiles,
        calibration: result.calibration,
      });
    });
  };

  const handleCalibrate = async () => {
    setCalibrating(true);
    setMessage(null);
    try {
      const result = await fetchRoutingScoreCalibration(PRACTICE_ID, {
        windowDays,
      });
      setPreview(result);
      if (result.sufficient) {
        applyCalibration(result);
        setMessage({
          text:
            result.calibration.source === 'replayed'
              ? 'Estimated from pre-change history. Your current settings were kept exactly as they were — nothing changes until you move a slider and save.'
              : 'Calibrated. Your current settings were kept exactly as they were — nothing changes until you move a slider and save.',
          kind: 'success',
        });
      } else {
        setMessage({
          text: 'Not enough recent scoring history to calibrate safely. Nothing was changed.',
          kind: 'error',
        });
      }
    } catch (err) {
      setMessage({ text: extractErr(err), kind: 'error' });
    } finally {
      setCalibrating(false);
    }
  };

  const setBucketPercent = (bucket: OfferableScoreDayBucket, raw: string) => {
    const pct = parsePercentile(raw);
    if (pct == null) return;
    setConfig((prev) =>
      resolveConfigFromPercentiles({
        ...prev,
        percentiles: { ...prev.percentiles, [bucket]: pct },
      })
    );
  };

  const setDefaultBucket = (bucket: OfferableScoreDayBucket, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    setConfig((prev) => ({
      ...prev,
      defaults: { ...prev.defaults, [bucket]: Math.round(n) },
    }));
  };

  const setTypeBucketPercent = (typeId: number, bucket: OfferableScoreDayBucket, raw: string) => {
    const key = String(typeId);
    const pct = raw.trim() ? parsePercentile(raw) : null;
    setConfig((prev) => {
      const existing: OfferableScorePercentilesByBucket = {
        ...(prev.byAppointmentTypeIdPercentiles[key] ?? {}),
      };
      const nextScores = { ...prev.byAppointmentTypeId };
      if (pct == null) {
        delete existing[bucket];
        // Drop the resolved score too, otherwise clearing the percentage would
        // leave a stale override behind that still gates.
        const scores: OfferableScoreThresholdsByBucket = {
          ...(nextScores[key] ?? {}),
        };
        delete scores[bucket];
        if (Object.keys(scores).length === 0) delete nextScores[key];
        else nextScores[key] = scores;
      } else {
        existing[bucket] = pct;
      }
      const nextPcts = { ...prev.byAppointmentTypeIdPercentiles };
      if (Object.keys(existing).length === 0) delete nextPcts[key];
      else nextPcts[key] = existing;
      return resolveConfigFromPercentiles({
        ...prev,
        byAppointmentTypeId: nextScores,
        byAppointmentTypeIdPercentiles: nextPcts,
      });
    });
  };

  const setTypeBucketScore = (typeId: number, bucket: OfferableScoreDayBucket, raw: string) => {
    const key = String(typeId);
    const parsed = parseOptionalScore(raw);
    setConfig((prev) => {
      const existing: OfferableScoreThresholdsByBucket = {
        ...(prev.byAppointmentTypeId[key] ?? {}),
      };
      if (parsed == null) delete existing[bucket];
      else existing[bucket] = parsed;
      const nextByType = { ...prev.byAppointmentTypeId };
      if (Object.keys(existing).length === 0) delete nextByType[key];
      else nextByType[key] = existing;
      return { ...prev, byAppointmentTypeId: nextByType };
    });
  };

  const clearTypeOverrides = (typeId: number) => {
    const key = String(typeId);
    setConfig((prev) => {
      const nextByType = { ...prev.byAppointmentTypeId };
      const nextPcts = { ...prev.byAppointmentTypeIdPercentiles };
      delete nextByType[key];
      delete nextPcts[key];
      return {
        ...prev,
        byAppointmentTypeId: nextByType,
        byAppointmentTypeIdPercentiles: nextPcts,
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveRoutingOfferableScoreThresholds(PRACTICE_ID, config);
      setConfig(saved);
      setMessage({ text: 'Offer thresholds saved.', kind: 'success' });
    } catch (err) {
      setMessage({ text: extractErr(err), kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page" style={{ padding: '1.5rem 1.75rem' }}>
      <div className="settings-header" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Client-offered slot quality</h2>
        <p className="settings-section-description" style={{ marginTop: 8, maxWidth: 760 }}>
          These settings decide which slots a client is shown when they self-schedule, and which
          texted offers still book when tapped. There is no separate auto-book setting: anything a
          client can see, a client can book. Loosening here loosens auto-booking by exactly the same
          amount. Every online self-booking still lands in the Auto-Booked queue for staff review.
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
          <button type="button" className="settings-close" onClick={() => setMessage(null)}>
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
          <section className="settings-section rst-calibration">
            <h3 style={{ marginTop: 0 }}>Step 1 — Calibrate</h3>
            <p className="settings-section-description" style={{ marginTop: 0, maxWidth: 760 }}>
              A score on its own means nothing — it only means something relative to the other slots
              the router found. Calibrating measures your recent scores so a setting can be
              expressed as <em>offer the best N% of slots</em> instead of a bare number that
              silently changes meaning whenever routing changes.
            </p>

            <div className="rst-calibrate-row">
              <label className="settings-label" htmlFor="rst-window">
                Measure the last
              </label>
              <select
                id="rst-window"
                className="settings-input"
                style={{ maxWidth: 140 }}
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
              >
                {WINDOW_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="settings-btn settings-btn-primary"
                disabled={calibrating}
                onClick={() => void handleCalibrate()}
              >
                {calibrating ? 'Measuring…' : 'Calibrate now'}
              </button>
            </div>

            {calibrated ? (
              <div
                className={
                  calibration.source === 'replayed'
                    ? 'rst-status rst-status-warn'
                    : 'rst-status rst-status-ok'
                }
              >
                <strong>
                  {calibration.source === 'replayed' ? 'Estimated ' : 'Calibrated '}
                  {formatWhen(calibration.generatedAt)}
                </strong>
                <div>
                  {calibration.sampleSize.toLocaleString()} scored slots from{' '}
                  {calibration.doctorCount} doctor
                  {calibration.doctorCount === 1 ? '' : 's'} over the last {calibration.windowDays}{' '}
                  days
                  {calibration.excludedDoctorCount > 0
                    ? `, with ${calibration.excludedDoctorCount} ramping doctor${
                        calibration.excludedDoctorCount === 1 ? '' : 's'
                      } left out`
                    : ''}
                  .
                </div>
                {calibration.source === 'replayed' ? (
                  <div style={{ marginTop: 4 }}>
                    Reconstructed from history that predates the last scoring change, because no
                    slots have been scored on the current scale yet. Good enough to set the bar with
                    — recalibrate in a few weeks for a direct measurement.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rst-status rst-status-warn">
                <strong>Not calibrated yet</strong>
                <div>
                  Until you calibrate, the settings below are raw scores and the percentage sliders
                  stay locked. Calibrating does not change any threshold on its own.
                </div>
              </div>
            )}

            {preview?.warnings.length ? (
              <ul className="rst-warnings">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="settings-section" style={{ marginBottom: 28 }}>
            <h3 style={{ marginTop: 0 }}>Step 2 — Set the quality bar</h3>
            <p className="settings-section-description" style={{ marginTop: 0, maxWidth: 760 }}>
              {calibrated
                ? 'Each slider is the share of possible slots good enough to offer. Lower is stricter: less driving, fewer times available. The score underneath is what actually gets stored.'
                : 'Calibrate above to set these as percentages. Until then they are raw scores, where lower is a better-fitting slot.'}
            </p>

            {calibrated ? (
              <div className="rst-sliders">
                {OFFERABLE_SCORE_DAY_BUCKETS.map((bucket) => {
                  const pct = bucketPercent(bucket) ?? 50;
                  const score = scoreAtPercentile(calibration, pct);
                  return (
                    <div key={bucket} className="rst-slider-row">
                      <div className="rst-slider-head">
                        <label className="settings-label" htmlFor={`rst-${bucket}`}>
                          {OFFERABLE_SCORE_DAY_BUCKET_LABELS[bucket]}
                        </label>
                        <span className="rst-slider-value">
                          {qualityWord(pct)} · best {pct}%
                        </span>
                      </div>
                      <input
                        id={`rst-${bucket}`}
                        type="range"
                        min={1}
                        max={100}
                        step={1}
                        className="rst-range"
                        value={pct}
                        title={OFFERABLE_SCORE_DAY_BUCKET_HINTS[bucket]}
                        onChange={(e) => setBucketPercent(bucket, e.target.value)}
                      />
                      <div className="rst-slider-foot">
                        <span>{OFFERABLE_SCORE_DAY_BUCKET_HINTS[bucket]}</span>
                        <span className="rst-score">score ≤ {score}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
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
                    <label className="settings-label" htmlFor={`rst-score-${bucket}`}>
                      {OFFERABLE_SCORE_DAY_BUCKET_LABELS[bucket]}
                    </label>
                    <input
                      id={`rst-score-${bucket}`}
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
              </div>
            )}

            <div className="settings-form-group" style={{ marginTop: 20, maxWidth: 320 }}>
              <label className="settings-label" htmlFor="rst-member-bonus">
                Member bonus
              </label>
              <input
                id="rst-member-bonus"
                type="number"
                min={0}
                step={1}
                className="settings-input"
                value={config.memberBonus}
                title="Extra score allowance for member-tier online booking"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n) || n < 0) return;
                  setConfig((prev) => ({ ...prev, memberBonus: Math.round(n) }));
                }}
              />
              <p className="settings-section-description" style={{ marginTop: 6 }}>
                {calibrated
                  ? (() => {
                      const base = bucketPercent('later') ?? 50;
                      const memberPct = percentileForScore(
                        calibration,
                        scoreAtPercentile(calibration, base) + config.memberBonus
                      );
                      return memberPct != null
                        ? `Members reach roughly the best ${memberPct}% where everyone else gets ${base}%. Stays a score, not a percentage, so it keeps its size as the bar moves.`
                        : 'Extra score allowance for members.';
                    })()
                  : 'Added to the resolved threshold for member-tier online booking.'}
              </p>
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
              {calibrated
                ? 'Percentages, same meaning as the sliders above. Leave a cell blank to inherit the default; the resolved score is shown underneath.'
                : 'Raw scores. Leave a cell blank to use the global default for that bucket.'}
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
                      const pctOverrides = config.byAppointmentTypeIdPercentiles[key] ?? {};
                      const hasOverrides =
                        Object.keys(overrides).length > 0 || Object.keys(pctOverrides).length > 0;
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
                              {calibrated ? (
                                <>
                                  <div className="rst-pct-input">
                                    <input
                                      type="number"
                                      min={1}
                                      max={100}
                                      step={1}
                                      className="settings-input"
                                      style={{ width: 72 }}
                                      placeholder={String(bucketPercent(bucket) ?? '')}
                                      value={
                                        pctOverrides[bucket] != null
                                          ? String(pctOverrides[bucket])
                                          : ''
                                      }
                                      onChange={(e) =>
                                        setTypeBucketPercent(type.id, bucket, e.target.value)
                                      }
                                    />
                                    <span aria-hidden="true">%</span>
                                  </div>
                                  {pctOverrides[bucket] != null ? (
                                    <div className="rst-cell-score">
                                      ≤ {scoreAtPercentile(calibration, pctOverrides[bucket]!)}
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="settings-input"
                                  style={{ width: 88 }}
                                  placeholder={String(config.defaults[bucket])}
                                  value={overrides[bucket] != null ? String(overrides[bucket]) : ''}
                                  onChange={(e) =>
                                    setTypeBucketScore(type.id, bucket, e.target.value)
                                  }
                                />
                              )}
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
