import { useState } from 'react';
import SendRxLabelButton from './SendRxLabelButton';
import {
  MAIL_ORDER_BAG_NOTES_MAX,
  printMailOrderBagLabelWithSystemDialog,
  type MailOrderBagLabelData,
} from '../../utils/dymoPrescriptionLabel';
import { printMailOrderBagLabelDirect } from '../../utils/printRxLabel';
import { ensurePrintRxNumber } from '../../utils/ensurePrintRxNumber';
import type { MailOrder, MailOrderLine } from '../../api/onlineStore';

/**
 * The order's own notes for the bag label, without Scout's internal references (e.g. "invoice:<id>",
 * "invoiceLine:<id>"), which printed on the label (owner, Nov 11, 2026).
 */
export function bagLabelOrderNotes(notes?: string | null): string {
  return (notes || '')
    .replace(/\b(?:invoice|invoiceLine|shippingLine|autoshipInvoice):\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The label window's Acute / Chronic: auto-ships are chronic; a refill follows its Rx; otherwise acute. */
export function labelAcuity(line: Pick<MailOrderLine, 'autoship' | 'rxAcuity'>): 'acute' | 'chronic' {
  if (line.autoship) return 'chronic';
  return line.rxAcuity === 'chronic' ? 'chronic' : 'acute';
}

function clipNotes(value: string): string {
  const text = value.trim();
  if (text.length <= MAIL_ORDER_BAG_NOTES_MAX) return text;
  return `${text.slice(0, MAIL_ORDER_BAG_NOTES_MAX - 1).trimEnd()}…`;
}

/** Bag label format: `42.5 lb (3/15/2026)` — weight and when it was taken. */
function formatBagWeightLabel(
  weightLbs?: number | null,
  weightDate?: string | null,
): string | null {
  if (weightLbs == null || !Number.isFinite(Number(weightLbs))) return null;
  const n = Number(weightLbs);
  const lbs = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  const iso = weightDate?.slice(0, 10);
  const date = iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
      })
    : null;
  return date ? `${lbs} lb (${date})` : `${lbs} lb`;
}

function approvingDoctorName(order: MailOrder): string | null {
  const notes = order.approvalNotes || [];
  for (let i = notes.length - 1; i >= 0; i -= 1) {
    const note = notes[i];
    if (note?.kind === 'approved' && note.actorName?.trim()) return note.actorName.trim();
  }
  return null;
}

/**
 * Doctor who belongs on the label. The prescription's own prescriber, then the
 * doctor who approved this line, then the visit doctor on a staff order.
 * Never the pet's primary provider.
 */
export function mailLabelDoctor(
  order: MailOrder,
  line: MailOrderLine,
): { name: string | null; employeeId: number | null } {
  if (line.scriptPrescriberEmployeeId) {
    return {
      name: line.scriptPrescriberName ?? null,
      employeeId: line.scriptPrescriberEmployeeId,
    };
  }
  const signedOff = line.approvalDecision === 'approved' || line.authorizedRefills != null;
  if (signedOff) {
    const approver = approvingDoctorName(order);
    if (approver) {
      const sameAsOrderDoctor = Boolean(order.doctorEmployeeId) && approver === order.doctorName;
      return {
        name: approver,
        employeeId: sameAsOrderDoctor ? order.doctorEmployeeId ?? null : null,
      };
    }
  }
  if (order.origin !== 'online_store' && order.doctorEmployeeId) {
    return { name: order.doctorName ?? null, employeeId: order.doctorEmployeeId };
  }
  return { name: null, employeeId: null };
}

export default function MailOrderFillLabels({
  order,
  line,
  checkNotes,
  className = 'btn secondary',
}: {
  order: MailOrder;
  line: MailOrderLine;
  checkNotes?: string;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [bagNeedsDialog, setBagNeedsDialog] = useState(false);

  const bagNotes = clipNotes([checkNotes, bagLabelOrderNotes(order.notes)].filter(Boolean).join(' · '));
  const mailOrderNumber = `#${order.id}`;
  const patientWeight =
    formatBagWeightLabel(line.weightLbs, line.weightDate) ||
    formatBagWeightLabel(
      order.patients?.find((p) => p.id === line.patientId)?.weightLbs ??
        order.patients?.[0]?.weightLbs,
      order.patients?.find((p) => p.id === line.patientId)?.weightDate ??
        order.patients?.[0]?.weightDate,
    );

  const labelDoctor = mailLabelDoctor(order, line);

  const bagLabel: MailOrderBagLabelData = {
    orderNumber: mailOrderNumber,
    clientName: order.customerName,
    patientName: line.patientName || order.patientName || 'Household',
    patientWeight,
    notes: bagNotes,
  };

  /** Bag label alone: USB DYMO first; if that fails, offer the system print dialog. */
  const printBagOnDymo = async () => {
    setBagNeedsDialog(false);
    try {
      const printed = await printMailOrderBagLabelDirect(bagLabel);
      setStatus(`Printed the bag label on ${printed}.`);
      setError(null);
    } catch (e) {
      setStatus(null);
      setError(
        `${e instanceof Error ? e.message : 'Could not print the bag label on DYMO.'} Use the print dialog for a Bluetooth or Wi-Fi printer.`,
      );
      setBagNeedsDialog(true);
    }
  };

  const printBagWithDialog = () => {
    try {
      printMailOrderBagLabelWithSystemDialog(bagLabel);
      setStatus('Print dialog opened for the bag label.');
      setError(null);
      setBagNeedsDialog(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the print dialog.');
    }
  };

  return (
    <>
      <SendRxLabelButton
        className={className}
        label="Print Rx + bag labels"
        stopClickPropagation
        bagLabel={bagLabel}
        source={{
          patientId: line.patientId,
          patientName: line.patientName || order.patientName || 'Patient',
          ownerName: order.customerName,
          veterinarianName: labelDoctor.name,
          providerEmployeeId: labelDoctor.employeeId,
          quantity: line.quantity,
          name: line.name,
          strength: line.strength,
          instructions: line.scriptText || '',
          refill: line.authorizedRefills ?? line.refillsRemaining ?? 0,
          acuity: labelAcuity(line),
          rxNumber: line.rxNumber,
          mailOrderNumber,
          onSavePrescription: async (value) => {
            const rxNumber = await ensurePrintRxNumber({
              existingNumber: line.rxNumber,
              patientId: line.patientId,
              name: value.name,
              inventoryItemId: line.inventoryItemId,
              instructions: value.instructions,
              refill: value.refill,
              startDate: value.startDate,
              refillExpiration: value.refillExpiration,
              acuity: value.acuity,
            });
            return { rxNumber };
          },
        }}
        onError={(message) => {
          setError(message || null);
          setStatus(null);
        }}
        disabled={!labelDoctor.employeeId && !labelDoctor.name}
        onSuccess={(printerName, method) => {
          setError(null);
          setBagNeedsDialog(false);
          setStatus(
            method === 'system'
              ? 'Print dialog opened with the Rx and bag labels.'
              : `Printed Rx and bag labels on ${printerName}.`,
          );
        }}
      />
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          void printBagOnDymo();
        }}
      >
        Bag label only
      </button>
      {bagNeedsDialog ? (
        <button
          type="button"
          className={className}
          onClick={(e) => {
            e.stopPropagation();
            printBagWithDialog();
          }}
        >
          Bag label: use system print dialog
        </button>
      ) : null}
      {!labelDoctor.employeeId && !labelDoctor.name ? (
        <p className="mail-queue__danger-text">No doctor is on this script.</p>
      ) : null}
      {status ? <p className="settings-muted" style={{ margin: '6px 0 0', width: '100%' }}>{status}</p> : null}
      {error ? <p className="mail-queue__danger-text">{error}</p> : null}
    </>
  );
}
