// src/components/MedicalRecordModal.tsx
import React, { useEffect, useState } from 'react';
import {
  fetchMedicalRecord,
  type MedicalRecordResponse,
  type LabOrderEntry,
  type MedicalRecordMedication,
  type MedicalRecordExam,
} from '../api/patients';

type MedicalRecordModalProps = {
  patientId: string;
  petName: string;
  onClose: () => void;
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...(iso.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
  } catch {
    return String(iso);
  }
}

function LabOrderBlock({ entry }: { entry: LabOrderEntry }) {
  const { order, result } = entry;
  const [showXml, setShowXml] = useState(false);
  const hasXml = !!(result?.externalData && result.externalData.trim());

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        overflow: 'hidden',
        marginBottom: 12,
        background: '#fff',
      }}
    >
      <div style={{ padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <span style={{ fontWeight: 600, color: '#111827' }}>
              {order.labOrderType ?? 'Lab order'}
            </span>
            {order.submittedDate && (
              <span style={{ marginLeft: 8, fontSize: 13, color: '#6b7280' }}>
                Submitted {formatDate(order.submittedDate)}
              </span>
            )}
          </div>
          {hasXml && (
            <button
              type="button"
              onClick={() => setShowXml((x) => !x)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                color: showXml ? '#0f766e' : '#374151',
                background: showXml ? '#ccfbf1' : '#f3f4f6',
                border: `1px solid ${showXml ? '#0f766e' : '#d1d5db'}`,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {showXml ? 'Hide raw XML' : 'View raw XML'}
            </button>
          )}
        </div>
        {order.externalId && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            External ID: {order.externalId}
          </div>
        )}
      </div>
      {result?.reportDate && (
        <div style={{ padding: '10px 16px', fontSize: 13, color: '#374151' }}>
          Report date: {formatDate(result.reportDate)}
        </div>
      )}
      {hasXml && showXml && (
        <div
          style={{
            padding: 12,
            background: '#1f2937',
            borderTop: '1px solid #e5e7eb',
            maxHeight: 360,
            overflow: 'auto',
          }}
        >
          <pre
            style={{
              margin: 0,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11,
              lineHeight: 1.5,
              color: '#e5e7eb',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {result!.externalData!.trim()}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function MedicalRecordModal({
  patientId,
  petName,
  onClose,
}: MedicalRecordModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MedicalRecordResponse | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const res = await fetchMedicalRecord(patientId);
        if (alive) {
          setData(res);
        }
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data
            ?.message ??
          (e as { message?: string })?.message ??
          'Failed to load medical record';
        if (alive) setError(String(msg));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [patientId]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: 20,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="medical-record-title"
    >
      <div
        style={{
          maxWidth: 720,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 24,
          backgroundColor: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            paddingBottom: 12,
            borderBottom: '1px solid #e5e7eb',
          }}
        >
          <h2 id="medical-record-title" style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>
            Medical Record — {petName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#6b7280',
              padding: '4px 8px',
              lineHeight: 1,
              borderRadius: 6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#111827';
              e.currentTarget.style.background = 'rgba(15, 118, 110, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#6b7280';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            ×
          </button>
        </div>

        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
            Loading medical record…
          </div>
        )}

        {error && (
          <div
            style={{
              padding: 16,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              color: '#dc2626',
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {!loading && data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Patient */}
            <section>
              <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Patient
              </h3>
              <div
                style={{
                  padding: 16,
                  background: '#f0fdfa',
                  border: '1px solid #99f6e4',
                  borderRadius: 10,
                }}
              >
                <div style={{ display: 'grid', gap: 6, fontSize: 14 }}>
                  <div><strong>Name:</strong> {data.patient.name}</div>
                  {data.patient.species && <div><strong>Species:</strong> {data.patient.species}</div>}
                  {data.patient.breed && <div><strong>Breed:</strong> {data.patient.breed}</div>}
                  {data.patient.dob && <div><strong>DOB:</strong> {formatDate(data.patient.dob)}</div>}
                  {data.patient.sex && <div><strong>Sex:</strong> {data.patient.sex}</div>}
                  {data.patient.weight != null && <div><strong>Weight:</strong> {data.patient.weight}</div>}
                  {data.patient.alerts && (
                    <div style={{ color: '#b45309' }}><strong>Alerts:</strong> {data.patient.alerts}</div>
                  )}
                </div>
              </div>
            </section>

            {/* Practice */}
            {data.practice?.name && (
              <section>
                <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Practice
                </h3>
                <div style={{ padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 14 }}>
                  <div><strong>{data.practice.name}</strong></div>
                  {(data.practice.address1 || data.practice.city) && (
                    <div style={{ color: '#6b7280', marginTop: 4 }}>
                      {[data.practice.address1, data.practice.city, data.practice.state, data.practice.zipcode]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  )}
                  {(data.practice.phone1 || data.practice.phone2) && (
                    <div style={{ marginTop: 4 }}>
                      {[data.practice.phone1, data.practice.phone2].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Lab orders */}
            <section>
              <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Lab orders ({data.labOrders?.length ?? 0})
              </h3>
              {(!data.labOrders || data.labOrders.length === 0) ? (
                <div style={{ padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, color: '#6b7280', fontSize: 14 }}>
                  No lab orders.
                </div>
              ) : (
                <div>
                  {data.labOrders.map((entry) => (
                    <LabOrderBlock key={entry.order.id} entry={entry} />
                  ))}
                </div>
              )}
            </section>

            {/* Medications */}
            <section>
              <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Medications ({data.medications?.length ?? 0})
              </h3>
              {(!data.medications || data.medications.length === 0) ? (
                <div style={{ padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, color: '#6b7280', fontSize: 14 }}>
                  No medications.
                </div>
              ) : (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ background: '#f3f4f6' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Name</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.medications.map((m: MedicalRecordMedication) => (
                        <tr key={m.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '10px 12px' }}>{m.name}</td>
                          <td style={{ padding: '10px 12px', color: '#6b7280' }}>{formatDate(m.dateOfService)}</td>
                          <td style={{ padding: '10px 12px', color: '#6b7280' }}>{m.treatmentItem?.quantity ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Exams */}
            <section>
              <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Exams ({data.exams?.length ?? 0})
              </h3>
              {(!data.exams || data.exams.length === 0) ? (
                <div style={{ padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, color: '#6b7280', fontSize: 14 }}>
                  No exams.
                </div>
              ) : (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ background: '#f3f4f6' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Form</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Provider</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.exams.map((ex: MedicalRecordExam) => (
                        <tr key={ex.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '10px 12px' }}>{ex.formName ?? '—'}</td>
                          <td style={{ padding: '10px 12px', color: '#6b7280' }}>{formatDate(ex.serviceDate)}</td>
                          <td style={{ padding: '10px 12px', color: '#6b7280' }}>
                            {ex.employee?.firstName || ex.employee?.lastName
                              ? [ex.employee.firstName, ex.employee.lastName].filter(Boolean).join(' ')
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {((data.complaints?.length ?? 0) > 0 || (data.diagnoses?.length ?? 0) > 0 || (data.histories?.length ?? 0) > 0) && (
              <section>
                <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Other
                </h3>
                <div style={{ padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 14 }}>
                  {((data.complaints?.length ?? 0) > 0) && (
                    <div style={{ marginBottom: 8 }}>
                      <strong>Complaints:</strong> {data.complaints!.length} on file
                    </div>
                  )}
                  {((data.diagnoses?.length ?? 0) > 0) && (
                    <div style={{ marginBottom: 8 }}>
                      <strong>Diagnoses:</strong> {data.diagnoses!.length} on file
                    </div>
                  )}
                  {((data.histories?.length ?? 0) > 0) && (
                    <div><strong>Histories:</strong> {data.histories!.length} on file</div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}

        {!loading && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 20px',
                background: '#0f766e',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
