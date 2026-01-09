// src/components/VaccinationCertificateModal.tsx
import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { Pet, Vaccination, PracticeInfo } from '../api/clientPortal';
import { fetchPracticeInfo } from '../api/clientPortal';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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
              padding: 12px 20px;
              background: #f9fafb;
              border-left: 4px solid #0f766e;
            }
            .pet-grid {
              display: flex;
              flex-wrap: wrap;
              align-items: center;
              gap: 16px;
              font-size: 14px;
            }
            .pet-row {
              margin-bottom: 0;
            }
            .pet-label {
              font-weight: 600;
              color: #374151;
              font-size: 14px;
              margin-bottom: 0;
              display: inline;
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
                padding: 10px 16px;
              }
              .pet-grid {
                gap: 12px;
                font-size: 12px;
              }
              .pet-row {
                margin-bottom: 0;
              }
              .pet-label {
                font-size: 12px;
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

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;

    try {
      // Show loading state (optional - you could add a loading indicator)
      const element = printRef.current;
      
      // Use html2canvas to capture the certificate as an image
      const canvas = await html2canvas(element, {
        scale: 2, // Higher quality
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: element.scrollWidth,
        height: element.scrollHeight,
      });

      // Calculate PDF dimensions (letter size: 8.5 x 11 inches)
      const imgWidth = 8.5;
      const pageHeight = 11;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;

      // Create PDF
      const pdf = new jsPDF('portrait', 'in', 'letter');
      let position = 0;

      // Add image to PDF
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Add additional pages if content is taller than one page
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Generate filename
      const filename = `Vaccination_Certificate_${pet.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      // Save the PDF
      pdf.save(filename);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again or use the print option.');
    }
  };

  return (
    <>
      <style>{`
        @media (max-width: 768px) {
          .vacc-cert-modal-container {
            padding: 0 !important;
            align-items: flex-start !important;
            overflow: hidden !important;
            touch-action: none !important;
          }
          .vacc-cert-modal-container > * {
            touch-action: auto !important;
          }
          .vacc-cert-modal-content {
            padding: 8px !important;
            max-height: 100vh !important;
            height: 100vh !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            border-radius: 0 !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
            overscroll-behavior-y: contain !important;
            touch-action: pan-y !important;
          }
          .vacc-cert-modal-header {
            margin-bottom: 12px !important;
            padding-bottom: 8px !important;
          }
          .vacc-cert-modal-header h2 {
            font-size: 14px !important;
            line-height: 1.3 !important;
            word-break: break-word;
            flex: 1 !important;
            padding-right: 8px !important;
          }
          .vacc-cert-modal-header button {
            font-size: 20px !important;
            padding: 2px 6px !important;
            flex-shrink: 0 !important;
          }
          .vacc-cert-wrapper {
            padding: 12px 10px !important;
            border-width: 2px !important;
            max-width: 100% !important;
            margin: 0 !important;
          }
          .vacc-cert-inner-border {
            top: 4px !important;
            left: 4px !important;
            right: 4px !important;
            bottom: 4px !important;
          }
          .vacc-cert-header {
            flex-direction: column !important;
            align-items: center !important;
            gap: 12px !important;
            margin-bottom: 16px !important;
            padding-bottom: 12px !important;
          }
          .vacc-cert-logo {
            max-width: 120px !important;
          }
          .vacc-cert-practice-details-header {
            text-align: center !important;
            width: 100% !important;
            font-size: 10px !important;
            line-height: 1.5 !important;
          }
          .practice-row-header {
            margin-bottom: 3px !important;
          }
          .practice-label-header {
            font-size: 10px !important;
            margin-right: 4px !important;
          }
          .vacc-cert-title-section {
            margin-bottom: 20px !important;
          }
          .vacc-cert-title {
            font-size: 18px !important;
            margin-bottom: 4px !important;
          }
          .vacc-cert-subtitle {
            font-size: 12px !important;
          }
          .vacc-cert-pet-grid {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 6px !important;
            font-size: 12px !important;
          }
          .pet-separator {
            display: none !important;
          }
          .vacc-cert-pet-section {
            padding: 10px 12px !important;
            margin: 12px 0 !important;
          }
          .vacc-cert-vacc-section {
            margin-top: 16px !important;
          }
          .vacc-cert-section-heading {
            font-size: 11px !important;
            margin-bottom: 8px !important;
            letter-spacing: 0.5px !important;
          }
          .vacc-cert-table-wrapper {
            overflow-x: auto !important;
            overflow-y: visible !important;
            -webkit-overflow-scrolling: touch !important;
            width: 100% !important;
            margin-left: -10px !important;
            margin-right: -10px !important;
            padding-left: 10px !important;
            padding-right: 10px !important;
            touch-action: pan-x !important;
            overscroll-behavior-x: contain !important;
            will-change: scroll-position !important;
          }
          .vacc-cert-table {
            min-width: 500px !important;
            font-size: 10px !important;
            width: 100% !important;
          }
          .vacc-cert-table th {
            padding: 6px 8px !important;
            font-size: 8px !important;
            white-space: nowrap !important;
            letter-spacing: 0.3px !important;
          }
          .vacc-cert-table td {
            padding: 8px 8px !important;
            font-size: 9px !important;
            word-break: break-word !important;
          }
          .vacc-cert-footer {
            margin-top: 16px !important;
            padding-top: 12px !important;
            font-size: 9px !important;
          }
          .vacc-cert-footer strong {
            font-size: 11px !important;
            margin-bottom: 4px !important;
          }
          .vacc-cert-action-buttons {
            flex-direction: column !important;
            gap: 8px !important;
            margin-top: 16px !important;
          }
          .vacc-cert-action-buttons button {
            width: 100% !important;
            padding: 12px 20px !important;
            font-size: 14px !important;
          }
        }
        @media (max-width: 480px) {
          .vacc-cert-modal-content {
            padding: 4px !important;
          }
          .vacc-cert-modal-header h2 {
            font-size: 13px !important;
          }
          .vacc-cert-wrapper {
            padding: 10px 8px !important;
            border-width: 2px !important;
          }
          .vacc-cert-inner-border {
            top: 3px !important;
            left: 3px !important;
            right: 3px !important;
            bottom: 3px !important;
          }
          .vacc-cert-header {
            margin-bottom: 12px !important;
            padding-bottom: 10px !important;
            gap: 10px !important;
          }
          .pet-separator {
            display: none !important;
          }
          .vacc-cert-logo {
            max-width: 100px !important;
          }
          .vacc-cert-practice-details-header {
            font-size: 9px !important;
          }
          .practice-row-header {
            margin-bottom: 2px !important;
          }
          .vacc-cert-title-section {
            margin-bottom: 16px !important;
          }
          .vacc-cert-title {
            font-size: 16px !important;
            margin-bottom: 3px !important;
          }
          .vacc-cert-subtitle {
            font-size: 11px !important;
          }
          .vacc-cert-pet-section {
            padding: 8px 10px !important;
            margin: 10px 0 !important;
          }
          .vacc-cert-pet-grid {
            font-size: 11px !important;
            gap: 5px !important;
          }
          .vacc-cert-vacc-section {
            margin-top: 12px !important;
          }
          .vacc-cert-section-heading {
            font-size: 10px !important;
            margin-bottom: 6px !important;
          }
          .vacc-cert-table-wrapper {
            margin-left: -8px !important;
            margin-right: -8px !important;
            padding-left: 8px !important;
            padding-right: 8px !important;
          }
          .vacc-cert-table {
            min-width: 420px !important;
            font-size: 9px !important;
          }
          .vacc-cert-table th {
            padding: 5px 6px !important;
            font-size: 7px !important;
          }
          .vacc-cert-table td {
            padding: 6px 6px !important;
            font-size: 8px !important;
          }
          .vacc-cert-footer {
            margin-top: 12px !important;
            padding-top: 10px !important;
            font-size: 8px !important;
          }
          .vacc-cert-footer strong {
            font-size: 10px !important;
          }
          .vacc-cert-action-buttons {
            margin-top: 12px !important;
            gap: 6px !important;
          }
          .vacc-cert-action-buttons button {
            padding: 10px 16px !important;
            font-size: 13px !important;
          }
        }
        @media (max-width: 375px) {
          .vacc-cert-table {
            min-width: 380px !important;
          }
          .vacc-cert-modal-header h2 {
            font-size: 12px !important;
          }
          .vacc-cert-title {
            font-size: 14px !important;
          }
          .vacc-cert-subtitle {
            font-size: 10px !important;
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
            <div className="vacc-cert-title-section" style={{
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
              padding: '12px 20px',
              background: '#f9fafb',
              borderLeft: '4px solid #0f766e',
            }}>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '16px',
                fontSize: '14px',
              }}>
                <span>
                  <span style={{ fontWeight: 600, color: '#374151' }}>Pet's Name:</span>{' '}
                  <span style={{ color: '#111827' }}>{pet.name}</span>
                </span>
                {pet.species && (
                  <>
                    <span className="pet-separator" style={{ color: '#d1d5db' }}>|</span>
                    <span>
                      <span style={{ fontWeight: 600, color: '#374151' }}>Species:</span>{' '}
                      <span style={{ color: '#111827' }}>{pet.species}</span>
                    </span>
                  </>
                )}
                {pet.breed && (
                  <>
                    <span className="pet-separator" style={{ color: '#d1d5db' }}>|</span>
                    <span>
                      <span style={{ fontWeight: 600, color: '#374151' }}>Breed:</span>{' '}
                      <span style={{ color: '#111827' }}>{pet.breed}</span>
                    </span>
                  </>
                )}
                {pet.dob && (
                  <>
                    <span className="pet-separator" style={{ color: '#d1d5db' }}>|</span>
                    <span>
                      <span style={{ fontWeight: 600, color: '#374151' }}>Date of Birth:</span>{' '}
                      <span style={{ color: '#111827' }}>{formatDate(pet.dob)}</span>
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Vaccinations Table */}
            <div className="vacc-section vacc-cert-vacc-section" style={{ marginTop: '25px' }}>
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
          <button
            onClick={handleDownloadPDF}
            style={{
              padding: '10px 24px',
              backgroundColor: '#0f766e',
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download PDF
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
