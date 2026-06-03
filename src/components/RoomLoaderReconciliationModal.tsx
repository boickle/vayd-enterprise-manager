import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { getRoomLoaderReconciliation } from '../api/roomLoader';
import {
  buildReconciliationView,
  comparisonStateLabel,
  countChartTreatmentItems,
  formatUsd,
  type ComparisonRow,
  type ReconciliationView,
} from '../utils/roomLoaderReconciliation';
import '../pages/RoomLoader.css';

type Props = {
  roomLoaderId: number;
  onClose: () => void;
};

function ComparisonTable({ rows, title }: { rows: ComparisonRow[]; title: string }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: '12px' }}>
      <h4 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600 }}>{title}</h4>
      <div className="room-loader-reconcile-table-wrap">
        <table className="room-loader-reconcile-table">
          <thead>
            <tr>
              <th>Estimate (agreed)</th>
              <th>Visit (charted)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${row.key ?? 'row'}-${idx}`} className={`room-loader-reconcile-row--${row.state}`}>
                <td>
                  {row.agreed ? (
                    <div>
                      <div style={{ fontWeight: 500 }}>
                        {row.agreed.declined ? (
                          <span style={{ textDecoration: 'line-through', color: '#6b7280' }}>
                            {row.agreed.name}
                          </span>
                        ) : (
                          row.agreed.name
                        )}
                      </div>
                      {row.agreed.code ? (
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>{row.agreed.code}</div>
                      ) : null}
                      <div style={{ fontSize: '13px', marginTop: '2px' }}>
                        {formatUsd(row.agreed.amount)}
                        {row.agreed.quantity != null && row.agreed.quantity !== 1
                          ? ` × ${row.agreed.quantity}`
                          : ''}
                      </div>
                    </div>
                  ) : (
                    <span style={{ color: '#9ca3af' }}>—</span>
                  )}
                </td>
                <td>
                  {row.chart ? (
                    <div>
                      <div style={{ fontWeight: 500 }}>
                        {row.chart.declined ? (
                          <span style={{ textDecoration: 'line-through', color: '#6b7280' }}>
                            {row.chart.name}
                          </span>
                        ) : (
                          row.chart.name
                        )}
                        {row.chart.isEstimate ? (
                          <span
                            style={{
                              marginLeft: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#b45309',
                              background: '#fef3c7',
                              padding: '1px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            Estimate
                          </span>
                        ) : null}
                      </div>
                      {row.chart.code ? (
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>{row.chart.code}</div>
                      ) : null}
                      <div style={{ fontSize: '13px', marginTop: '2px' }}>
                        {formatUsd(row.chart.amount)}
                        {row.chart.quantity !== 1 ? ` × ${row.chart.quantity}` : ''}
                      </div>
                    </div>
                  ) : (
                    <span style={{ color: '#9ca3af' }}>—</span>
                  )}
                </td>
                <td>
                  <span className={`room-loader-reconcile-badge room-loader-reconcile-badge--${row.state}`}>
                    {comparisonStateLabel(row.state)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RoomLoaderReconciliationModal({ roomLoaderId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ReconciliationView | null>(null);
  const [noChartTreatment, setNoChartTreatment] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setNoChartTreatment(false);
      try {
        const data = await getRoomLoaderReconciliation(roomLoaderId);
        if (!cancelled) {
          if (countChartTreatmentItems(data) === 0) {
            setNoChartTreatment(true);
            setView(null);
          } else {
            setView(buildReconciliationView(data));
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg =
            (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            (err instanceof Error ? err.message : 'Failed to load reconciliation');
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomLoaderId]);

  return (
    <div
      className="room-loader-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-loader-reconcile-title"
      onClick={onClose}
    >
      <div
        className="room-loader-modal room-loader-reconcile-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="room-loader-modal-header">
          <h2 id="room-loader-reconcile-title" style={{ margin: 0, fontSize: '20px' }}>
            Reconcile — Room Loader #{roomLoaderId}
          </h2>
          <button type="button" className="btn-secondary room-loader-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loading ? (
          <p style={{ color: '#666' }}>Loading reconciliation…</p>
        ) : error ? (
          <p style={{ color: '#b91c1c' }}>{error}</p>
        ) : noChartTreatment ? (
          <p style={{ margin: 0, fontSize: '15px', color: '#4b5563' }}>No treatment for room loader</p>
        ) : view ? (
          <>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#4b5563' }}>{view.agreedSourceLabel}</p>
            {view.hasChartEstimate ? (
              <p
                style={{
                  margin: '0 0 16px',
                  padding: '10px 12px',
                  background: '#fff8e1',
                  border: '1px solid #ffe082',
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: '#664d03',
                }}
              >
                One or more visit plans are still marked as estimates in PIMS.
              </p>
            ) : null}

            {view.pets.map((pet) => (
              <section key={pet.patientId} className="room-loader-reconcile-pet">
                <div className="room-loader-reconcile-pet-header">
                  <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {pet.patientName}
                    {pet.isMember ? (
                      <span title={pet.membershipName?.trim() || 'Member'} style={{ display: 'inline-flex' }}>
                        <Heart size={16} fill="#e91e63" color="#e91e63" aria-hidden />
                      </span>
                    ) : null}
                  </h3>
                  <div className="room-loader-reconcile-pet-totals">
                    <span>
                      <strong>Estimate:</strong> {formatUsd(pet.estimateTotal)}
                    </span>
                    <span>
                      <strong>Visit:</strong> {formatUsd(pet.visitTotal)}
                    </span>
                    <span
                      className={
                        Math.abs(pet.estimateTotal - pet.visitTotal) > 0.01
                          ? 'room-loader-reconcile-diff'
                          : 'room-loader-reconcile-diff room-loader-reconcile-diff--ok'
                      }
                    >
                      <strong>Diff:</strong> {formatUsd(pet.visitTotal - pet.estimateTotal)}
                    </span>
                  </div>
                </div>

                <ComparisonTable rows={pet.matchedRows} title="Matched items" />
                <ComparisonTable rows={pet.unmatchedRows} title="Does not match" />
              </section>
            ))}

            <div className="room-loader-reconcile-grand-total">
              <div>
                <span className="room-loader-reconcile-grand-label">Estimate total</span>
                <span className="room-loader-reconcile-grand-value">{formatUsd(view.grandEstimateTotal)}</span>
              </div>
              <div>
                <span className="room-loader-reconcile-grand-label">Visit total</span>
                <span className="room-loader-reconcile-grand-value">{formatUsd(view.grandVisitTotal)}</span>
              </div>
              <div>
                <span className="room-loader-reconcile-grand-label">Difference</span>
                <span
                  className={`room-loader-reconcile-grand-value ${
                    Math.abs(view.grandEstimateTotal - view.grandVisitTotal) > 0.01
                      ? 'room-loader-reconcile-grand-value--diff'
                      : ''
                  }`}
                >
                  {formatUsd(view.grandVisitTotal - view.grandEstimateTotal)}
                </span>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
