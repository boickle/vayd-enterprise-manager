// src/components/VaccinationCertificateModal.tsx
import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { Pet, Vaccination, PracticeInfo } from '../api/clientPortal';
import { fetchPracticeInfo } from '../api/clientPortal';

type VaccinationCertificateModalProps = {
  pet: Pet;
  vaccinations: Vaccination[];
  onClose: () => void;
};

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatShortDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function formatVaccineName(name: string): string {
  if (!name) return name;
  if (name.startsWith('CV-')) {
    return name.substring(3); // Remove 'CV-' prefix (3 characters)
  }
  return name;
}

function deduplicateVaccinations(vaccinations: Vaccination[]): Vaccination[] {
  // Group by formatted vaccine name (after removing CV- prefix)
  const byFormattedName = new Map<string, Vaccination[]>();
  
  for (const vax of vaccinations) {
    const formattedName = formatVaccineName(vax.vaccineName).toLowerCase().trim();
    if (!byFormattedName.has(formattedName)) {
      byFormattedName.set(formattedName, []);
    }
    byFormattedName.get(formattedName)!.push(vax);
  }
  
  // For each group, keep only the most recent one (by dateVaccinated)
  const result: Vaccination[] = [];
  
  for (const group of byFormattedName.values()) {
    if (group.length === 0) continue;
    
    // Sort by dateVaccinated (most recent first), then pick the first one
    const sorted = [...group].sort((a, b) => {
      const dateA = a.dateVaccinated ? new Date(a.dateVaccinated).getTime() : 0;
      const dateB = b.dateVaccinated ? new Date(b.dateVaccinated).getTime() : 0;
      return dateB - dateA; // Descending order (most recent first)
    });
    
    result.push(sorted[0]);
  }
  
  return result;
}

export default function VaccinationCertificateModal({
  pet,
  vaccinations,
  onClose,
}: VaccinationCertificateModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const [practiceInfo, setPracticeInfo] = useState<PracticeInfo>({
    name: 'Vet At Your Door',
    phone: '(207) 536-8387',
    email: 'info@vetatyourdoor.com',
    website: 'www.vetatyourdoor.com',
  });

  useEffect(() => {
    (async () => {
      try {
        const info = await fetchPracticeInfo();
        if (info) {
          setPracticeInfo({
            name: info.name || practiceInfo.name,
            address1: info.address1 || info.address,
            city: info.city,
            state: info.state,
            zip: info.zip,
            phone: info.phone || practiceInfo.phone,
            email: info.email || practiceInfo.email,
            website: info.website || practiceInfo.website,
          });
        }
      } catch (error) {
        console.warn('Failed to fetch practice info:', error);
      }
    })();
  }, []);

  // Deduplicate vaccinations to show only the most recent one for each vaccine name
  const deduplicatedVaccinations = useMemo(
    () => deduplicateVaccinations(vaccinations),
    [vaccinations]
  );

  // Prevent iOS Safari scroll freeze by handling touch events properly
  useEffect(() => {
    const tableWrapper = tableWrapperRef.current;
    if (!tableWrapper) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let isScrolling = false;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isScrolling = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isScrolling) {
        const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
        const deltaY = Math.abs(e.touches[0].clientY - touchStartY);
        // Determine if this is primarily horizontal or vertical scrolling
        isScrolling = deltaX > 5 || deltaY > 5;
      }
    };

    tableWrapper.addEventListener('touchstart', handleTouchStart, { passive: true });
    tableWrapper.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      tableWrapper.removeEventListener('touchstart', handleTouchStart);
      tableWrapper.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  const handlePrint = () => {
    if (!printRef.current) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow pop-ups to print the certificate.');
      return;
    }

    const printContent = printRef.current.innerHTML;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Vaccination Certificate - ${pet.name}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              color: #111827;
              background: #fff;
              padding: 40px;
              line-height: 1.6;
            }
            .cert-wrapper {
              max-width: 850px;
              margin: 0 auto;
              background: #fff;
              border: 3px solid #0f766e;
              padding: 50px 60px;
              position: relative;
            }
            .cert-wrapper::before {
              content: '';
              position: absolute;
              top: 15px;
              left: 15px;
              right: 15px;
              bottom: 15px;
              border: 1px solid #d1d5db;
              pointer-events: none;
            }
            .cert-header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 40px;
              padding-bottom: 30px;
              border-bottom: 2px solid #0f766e;
            }
            .practice-details-header {
              flex: 1 1 auto;
              text-align: right;
              font-size: 13px;
              line-height: 1.6;
            }
            .practice-row-header {
              margin-bottom: 4px;
            }
            .practice-label-header {
              font-weight: 600;
              color: #374151;
              margin-right: 8px;
            }
            .cert-logo {
              max-width: 250px;
              height: auto;
              margin-bottom: 20px;
            }
            .cert-title {
              font-size: 32px;
              font-weight: 700;
              color: #0f766e;
              margin-bottom: 8px;
            }
            .cert-subtitle {
              font-size: 18px;
              color: #6b7280;
            }
            .pet-section {
              margin: 20px 0;
              padding: 15px 20px;
              background: #f9fafb;
              border-left: 4px solid #0f766e;
            }
            .pet-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 20px;
            }
            .pet-row {
              margin-bottom: 6px;
            }
            .pet-label {
              font-weight: 600;
              color: #374151;
              font-size: 13px;
              margin-bottom: 2px;
              display: block;
            }
            .pet-value {
              color: #111827;
              font-size: 14px;
            }
            .vacc-section {
              margin-top: 25px;
            }
            .section-heading {
              font-size: 16px;
              font-weight: 700;
              color: #0f766e;
              margin-bottom: 12px;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .vacc-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
              border: 1px solid #e5e7eb;
            }
            .vacc-table thead {
              background: #10b981;
              color: #fff;
            }
            .vacc-table th {
              padding: 10px 14px;
              text-align: left;
              font-weight: 600;
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              border-right: 1px solid rgba(255,255,255,0.2);
            }
            .vacc-table th:last-child { border-right: none; }
            .vacc-table tbody tr {
              border-bottom: 1px solid #e5e7eb;
            }
            .vacc-table tbody tr:last-child { border-bottom: none; }
            .vacc-table tbody tr:nth-child(even) {
              background: #f9fafb;
            }
            .vacc-table td {
              padding: 10px 14px;
              font-size: 13px;
            }
            .vacc-name {
              font-weight: 600;
              color: #111827;
            }
            .vacc-status {
              display: inline-block;
              padding: 5px 12px;
              border-radius: 5px;
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
            }
            .status-ok {
              background: #d1fae5;
              color: #065f46;
            }
            .status-bad {
              background: #fee2e2;
              color: #991b1b;
            }
            .practice-text {
              font-size: 14px;
              font-weight: 500;
            }
            .practice-good {
              color: #10b981;
              font-weight: 600;
            }
            .practice-bad {
              color: #ef4444;
              font-weight: 600;
            }
            .practice-details {
              margin-top: 30px;
              padding: 20px;
              background: #f9fafb;
              border: 1px solid #e5e7eb;
            }
            .practice-row {
              margin-bottom: 8px;
              font-size: 14px;
            }
            .practice-row:last-child { margin-bottom: 0; }
            .practice-label {
              font-weight: 600;
              color: #374151;
              margin-right: 10px;
            }
            .cert-footer {
              margin-top: 35px;
              padding-top: 25px;
              border-top: 1px solid #e5e7eb;
              text-align: center;
              color: #6b7280;
              font-size: 13px;
            }
              .cert-footer strong {
              color: #10b981;
              font-size: 15px;
              display: block;
              margin-bottom: 8px;
            }
            @media print {
              body { padding: 0; margin: 0; }
              .cert-wrapper {
                border: 2px solid #0f766e;
                padding: 20px 30px;
                max-width: 100%;
                margin: 0;
                page-break-inside: avoid;
              }
              .cert-header {
                margin-bottom: 15px;
                padding-bottom: 12px;
              }
              .cert-logo {
                max-width: 150px;
              }
              .practice-details-header {
                font-size: 11px;
              }
              .practice-row-header {
                margin-bottom: 2px;
              }
              .cert-title {
                font-size: 24px;
                margin-bottom: 4px;
              }
              .cert-subtitle {
                font-size: 14px;
              }
              .practice-details {
                margin-top: 15px;
                margin-bottom: 15px;
                padding: 12px 15px;
              }
              .practice-row {
                margin-bottom: 4px;
                font-size: 12px;
              }
              .pet-section {
                margin: 15px 0;
                padding: 12px 16px;
              }
              .pet-row {
                margin-bottom: 4px;
              }
              .pet-label {
                font-size: 11px;
              }
              .pet-value {
                font-size: 12px;
              }
              .vacc-section {
                margin-top: 15px;
              }
              .section-heading {
                font-size: 14px;
                margin-bottom: 8px;
              }
              .vacc-table {
                margin-top: 8px;
              }
              .vacc-table th {
                padding: 6px 10px;
                font-size: 10px;
              }
              .vacc-table td {
                padding: 8px 10px;
                font-size: 11px;
              }
              .vacc-status {
                padding: 2px 6px;
                font-size: 9px;
              }
              .cert-footer {
                margin-top: 20px;
                padding-top: 15px;
                font-size: 11px;
              }
              .cert-footer strong {
                font-size: 13px;
                margin-bottom: 4px;
              }
              @page { 
                margin: 0.5cm; 
                size: letter; 
              }
            }
          </style>
        </head>
        <body>
          ${printContent}
        </body>
      </html>
    `);

    printWindow.document.close();
    
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      printWindow.onafterprint = () => {
        printWindow.close();
      };
    }, 250);
  };

  return (
    <>
      <style>{`
        @media (max-width: 768px) {
          .vacc-cert-modal-container {
            padding: 8px !important;
            align-items: flex-start !important;
            padding-top: 8px !important;
            overflow: hidden !important;
            touch-action: none !important;
          }
          .vacc-cert-modal-container > * {
            touch-action: auto !important;
          }
          .vacc-cert-modal-content {
            padding: 12px !important;
            max-height: 98vh !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
            overscroll-behavior-y: contain !important;
            touch-action: pan-y !important;
          }
          .vacc-cert-modal-header h2 {
            font-size: 16px !important;
            line-height: 1.4 !important;
            word-break: break-word;
          }
          .vacc-cert-wrapper {
            padding: 16px 12px !important;
            border-width: 2px !important;
            max-width: 100% !important;
            margin: 0 !important;
          }
          .vacc-cert-inner-border {
            top: 6px !important;
            left: 6px !important;
            right: 6px !important;
            bottom: 6px !important;
          }
          .vacc-cert-header {
            flex-direction: column !important;
            align-items: center !important;
            gap: 16px !important;
            margin-bottom: 20px !important;
            padding-bottom: 16px !important;
          }
          .vacc-cert-logo {
            max-width: 150px !important;
          }
          .vacc-cert-practice-details-header {
            text-align: center !important;
            width: 100% !important;
            font-size: 11px !important;
          }
          .vacc-cert-title {
            font-size: 20px !important;
            margin-bottom: 6px !important;
          }
          .vacc-cert-subtitle {
            font-size: 13px !important;
          }
          .vacc-cert-pet-grid {
            grid-template-columns: 1fr !important;
            gap: 12px !important;
          }
          .vacc-cert-pet-section {
            padding: 12px 14px !important;
            margin: 14px 0 !important;
          }
          .vacc-cert-table-wrapper {
            overflow-x: auto !important;
            overflow-y: visible !important;
            -webkit-overflow-scrolling: touch !important;
            width: 100% !important;
            margin-left: -12px !important;
            margin-right: -12px !important;
            padding-left: 12px !important;
            padding-right: 12px !important;
            touch-action: pan-x !important;
            overscroll-behavior-x: contain !important;
            will-change: scroll-position !important;
          }
          .vacc-cert-table {
            min-width: 550px !important;
            font-size: 11px !important;
            width: 100% !important;
          }
          .vacc-cert-table th {
            padding: 6px 8px !important;
            font-size: 9px !important;
            white-space: nowrap !important;
          }
          .vacc-cert-table td {
            padding: 8px 8px !important;
            font-size: 10px !important;
            word-break: break-word !important;
          }
          .vacc-cert-section-heading {
            font-size: 12px !important;
            margin-bottom: 10px !important;
          }
          .vacc-cert-footer {
            margin-top: 20px !important;
            padding-top: 16px !important;
            font-size: 10px !important;
          }
          .vacc-cert-footer strong {
            font-size: 12px !important;
          }
          .vacc-cert-action-buttons {
            flex-direction: column !important;
            gap: 8px !important;
          }
          .vacc-cert-action-buttons button {
            width: 100% !important;
          }
        }
        @media (max-width: 480px) {
          .vacc-cert-modal-container {
            padding: 4px !important;
          }
          .vacc-cert-modal-content {
            padding: 8px !important;
            border-radius: 8px !important;
          }
          .vacc-cert-wrapper {
            padding: 12px 8px !important;
            border-width: 2px !important;
          }
          .vacc-cert-inner-border {
            top: 4px !important;
            left: 4px !important;
            right: 4px !important;
            bottom: 4px !important;
          }
          .vacc-cert-title {
            font-size: 16px !important;
          }
          .vacc-cert-subtitle {
            font-size: 11px !important;
          }
          .vacc-cert-table-wrapper {
            margin-left: -8px !important;
            margin-right: -8px !important;
            padding-left: 8px !important;
            padding-right: 8px !important;
            touch-action: pan-x !important;
            overscroll-behavior-x: contain !important;
          }
          .vacc-cert-table {
            min-width: 450px !important;
            font-size: 10px !important;
          }
          .vacc-cert-table th {
            padding: 5px 6px !important;
            font-size: 8px !important;
          }
          .vacc-cert-table td {
            padding: 6px 6px !important;
            font-size: 9px !important;
          }
          .vacc-cert-pet-section {
            padding: 10px 12px !important;
          }
        }
        @media (max-width: 375px) {
          .vacc-cert-table {
            min-width: 400px !important;
          }
        }
      `}</style>
      <div
        className="vacc-cert-modal-container"
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px',
        }}
        onClick={onClose}
      >
        <div
          className="vacc-cert-modal-content"
          style={{
            maxWidth: '1000px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorY: 'contain',
            touchAction: 'pan-y',
            padding: '32px',
            backgroundColor: '#f6fbf9',
            borderRadius: '12px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
        {/* Modal Header */}
        <div
          className="vacc-cert-modal-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
            paddingBottom: '12px',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          <h2 className="vacc-cert-modal-header" style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111827' }}>
            Vaccination Certificate - {pet.name}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: 'rgba(0,0,0,0.62)',
              padding: '4px 8px',
              lineHeight: 1,
              borderRadius: '6px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#111827';
              e.currentTarget.style.background = 'rgba(15, 118, 110, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'rgba(0,0,0,0.62)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            ×
          </button>
        </div>

        {/* Certificate Content */}
        <div ref={printRef}>
          <div className="cert-wrapper vacc-cert-wrapper" style={{
            maxWidth: '850px',
            margin: '0 auto',
            background: '#fff',
            border: '3px solid #0f766e',
            padding: '50px 60px',
            position: 'relative',
          }}>
            {/* Inner border */}
            <div className="vacc-cert-inner-border" style={{
              position: 'absolute',
              top: '15px',
              left: '15px',
              right: '15px',
              bottom: '15px',
              border: '1px solid #d1d5db',
              pointerEvents: 'none',
            }} />

            {/* Header */}
            <div className="cert-header vacc-cert-header" style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '40px',
              paddingBottom: '30px',
              borderBottom: '2px solid #0f766e',
            }}>
              {/* Logo Section */}
              <div style={{ flex: '0 0 auto' }}>
                <img
                  src="/final_thick_lines_cropped.jpeg"
                  alt="Vet At Your Door logo"
                  className="cert-logo vacc-cert-logo"
                  style={{
                    maxWidth: '200px',
                    height: 'auto',
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>

              {/* Practice Info Section */}
              <div className="practice-details-header vacc-cert-practice-details-header" style={{
                flex: '1 1 auto',
                textAlign: 'right',
                fontSize: '13px',
                lineHeight: '1.6',
              }}>
                {practiceInfo.address1 && (
                  <div className="practice-row-header" style={{ marginBottom: '4px' }}>
                    <span className="practice-label-header" style={{
                      fontWeight: 600,
                      color: '#374151',
                      marginRight: '8px',
                    }}>
                      Address:
                    </span>
                    <span style={{ color: '#10b981', fontWeight: 500 }}>
                      {practiceInfo.address1}
                      {practiceInfo.city && `, ${practiceInfo.city}`}
                      {practiceInfo.state && `, ${practiceInfo.state}`}
                      {practiceInfo.zip && ` ${practiceInfo.zip}`}
                    </span>
                  </div>
                )}
                {practiceInfo.phone && (
                  <div className="practice-row-header" style={{ marginBottom: '4px' }}>
                    <span className="practice-label-header" style={{
                      fontWeight: 600,
                      color: '#374151',
                      marginRight: '8px',
                    }}>
                      Phone:
                    </span>
                    <span style={{ color: '#10b981', fontWeight: 500 }}>{practiceInfo.phone}</span>
                  </div>
                )}
                {practiceInfo.email && (
                  <div className="practice-row-header" style={{ marginBottom: '4px' }}>
                    <span className="practice-label-header" style={{
                      fontWeight: 600,
                      color: '#374151',
                      marginRight: '8px',
                    }}>
                      Email:
                    </span>
                    <span style={{ color: '#10b981', fontWeight: 500 }}>{practiceInfo.email}</span>
                  </div>
                )}
                {practiceInfo.website && (
                  <div className="practice-row-header" style={{ marginBottom: '4px' }}>
                    <span className="practice-label-header" style={{
                      fontWeight: 600,
                      color: '#374151',
                      marginRight: '8px',
                    }}>
                      Website:
                    </span>
                    <span style={{ color: '#10b981', fontWeight: 500 }}>{practiceInfo.website}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Certificate Title */}
            <div style={{
              textAlign: 'center',
              marginBottom: '40px',
            }}>
              <div className="cert-title vacc-cert-title" style={{
                fontSize: '32px',
                fontWeight: 700,
                color: '#0f766e',
                marginBottom: '8px',
              }}>
                Pet Vaccination Certificate
              </div>
              <div className="cert-subtitle vacc-cert-subtitle" style={{
                fontSize: '18px',
                color: '#6b7280',
              }}>
                {practiceInfo.name || 'Vet At Your Door'}
              </div>
            </div>

            {/* Pet Information */}
            <div className="pet-section vacc-cert-pet-section" style={{
              margin: '20px 0',
              padding: '15px 20px',
              background: '#f9fafb',
              borderLeft: '4px solid #0f766e',
            }}>
              <div className="pet-grid vacc-cert-pet-grid" style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '20px',
              }}>
                <div>
                  <div className="pet-row" style={{ marginBottom: '6px' }}>
                    <span className="pet-label" style={{
                      fontWeight: 600,
                      color: '#374151',
                      fontSize: '13px',
                      marginBottom: '2px',
                      display: 'block',
                    }}>
                      Pet's Name:
                    </span>
                    <span className="pet-value" style={{
                      color: '#111827',
                      fontSize: '14px',
                    }}>
                      {pet.name}
                    </span>
                  </div>
                  {pet.species && (
                    <div className="pet-row" style={{ marginBottom: '6px' }}>
                      <span className="pet-label" style={{
                        fontWeight: 600,
                        color: '#374151',
                        fontSize: '13px',
                        marginBottom: '2px',
                        display: 'block',
                      }}>
                        Species:
                      </span>
                      <span className="pet-value" style={{
                        color: '#111827',
                        fontSize: '14px',
                      }}>
                        {pet.species}
                      </span>
                    </div>
                  )}
                </div>
                <div>
                  {pet.breed && (
                    <div className="pet-row" style={{ marginBottom: '6px' }}>
                      <span className="pet-label" style={{
                        fontWeight: 600,
                        color: '#374151',
                        fontSize: '13px',
                        marginBottom: '2px',
                        display: 'block',
                      }}>
                        Breed:
                      </span>
                      <span className="pet-value" style={{
                        color: '#111827',
                        fontSize: '14px',
                      }}>
                        {pet.breed}
                      </span>
                    </div>
                  )}
                  {pet.dob && (
                    <div className="pet-row" style={{ marginBottom: '6px' }}>
                      <span className="pet-label" style={{
                        fontWeight: 600,
                        color: '#374151',
                        fontSize: '13px',
                        marginBottom: '2px',
                        display: 'block',
                      }}>
                        Date of Birth:
                      </span>
                      <span className="pet-value" style={{
                        color: '#111827',
                        fontSize: '14px',
                      }}>
                        {formatDate(pet.dob)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Vaccinations Table */}
            <div className="vacc-section" style={{ marginTop: '25px' }}>
              <div className="section-heading vacc-cert-section-heading" style={{
                fontSize: '16px',
                fontWeight: 700,
                color: '#0f766e',
                marginBottom: '12px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}>
                Vaccination Details
              </div>
              {deduplicatedVaccinations.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>
                  No vaccination records available.
                </div>
              ) : (
                <div 
                  ref={tableWrapperRef}
                  className="vacc-cert-table-wrapper" 
                  style={{
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    width: '100%',
                    touchAction: 'pan-x',
                    overscrollBehaviorX: 'contain',
                  }}
                >
                <table className="vacc-table vacc-cert-table" style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  marginTop: '10px',
                  border: '1px solid #e5e7eb',
                }}>
                  <thead>
                    <tr>
                      <th style={{
                        padding: '10px 14px',
                        textAlign: 'left',
                        fontWeight: 600,
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        borderRight: '1px solid rgba(255,255,255,0.2)',
                        background: '#10b981',
                        color: '#fff',
                        width: '50%',
                      }}>
                        Vaccine Name
                      </th>
                      <th style={{
                        padding: '10px 14px',
                        textAlign: 'left',
                        fontWeight: 600,
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        borderRight: '1px solid rgba(255,255,255,0.2)',
                        background: '#10b981',
                        color: '#fff',
                        width: '20%',
                      }}>
                        Status
                      </th>
                      <th style={{
                        padding: '10px 14px',
                        textAlign: 'left',
                        fontWeight: 600,
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        background: '#10b981',
                        color: '#fff',
                        width: '30%',
                      }}>
                        Administered By
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {deduplicatedVaccinations.map((vaccination, idx) => {
                      const isValid = vaccination.isCurrent;
                      const practiceName = vaccination.practiceName || 'Vet At Your Door';
                      
                      return (
                        <tr
                          key={vaccination.id}
                          style={{
                            borderBottom: '1px solid #e5e7eb',
                            background: idx % 2 === 0 ? '#fff' : '#f9fafb',
                          }}
                        >
                          <td style={{
                            padding: '10px 14px',
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#111827',
                          }}>
                            <div style={{ marginBottom: '2px' }}>
                              {formatVaccineName(vaccination.vaccineName)}
                            </div>
                            {vaccination.nextVaccinationDate && (
                              <div style={{
                                fontSize: '11px',
                                fontWeight: 400,
                                color: '#6b7280',
                                fontStyle: 'italic',
                              }}>
                                {isValid ? 'Expires:' : 'Expired:'} {formatShortDate(vaccination.nextVaccinationDate)}
                              </div>
                            )}
                          </td>
                          <td style={{
                            padding: '10px 14px',
                            fontSize: '13px',
                          }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                background: isValid ? '#d1fae5' : '#fee2e2',
                                color: isValid ? '#065f46' : '#991b1b',
                              }}
                            >
                              {isValid ? 'Current' : 'Expired'}
                            </span>
                          </td>
                          <td style={{
                            padding: '10px 14px',
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#10b981',
                          }}>
                            {practiceName}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="cert-footer vacc-cert-footer" style={{
              marginTop: '35px',
              paddingTop: '25px',
              borderTop: '1px solid #e5e7eb',
              textAlign: 'center',
              color: '#6b7280',
              fontSize: '13px',
            }}>
              <strong style={{
                color: '#10b981',
                fontSize: '15px',
                display: 'block',
                marginBottom: '8px',
              }}>
                {practiceInfo.name || 'Vet At Your Door'}
              </strong>
              <div>This certificate is issued for the above-named pet.</div>
              <div style={{ marginTop: '10px', fontSize: '12px' }}>
                Certificate generated on {formatDate(new Date().toISOString())}
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div
          className="vacc-cert-action-buttons"
          style={{
            marginTop: '24px',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '10px 24px',
              backgroundColor: '#e5e7eb',
              color: '#374151',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            style={{
              padding: '10px 24px',
              backgroundColor: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ width: 18, height: 18 }}
            >
              <polyline points="6 9 6 2 18 2 18 9"></polyline>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
              <rect x="6" y="14" width="12" height="8"></rect>
            </svg>
            Print Certificate
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
