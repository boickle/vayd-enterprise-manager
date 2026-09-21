import { useState } from 'react';
import SendRxLabelButton from './SendRxLabelButton';
import {
  MAIL_ORDER_BAG_NOTES_MAX,
} from '../../utils/dymoPrescriptionLabel';
import { printMailOrderBagLabelDirect } from '../../utils/printRxLabel';
import { ensurePrintRxNumber } from '../../utils/ensurePrintRxNumber';
import type { MailOrder, MailOrderLine } from '../../api/onlineStore';

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

  const bagNotes = clipNotes([checkNotes, order.notes].filter(Boolean).join(' · '));
  const mailOrderNumber = `#${order.id}`;
  const patientWeight =
    formatBagWeightLabel(line.weightLbs, line.weightDate) ||
    formatBagWeightLabel(
      order.patients?.find((p) => p.id === line.patientId)?.weightLbs ??
        order.patients?.[0]?.weightLbs,
      order.patients?.find((p) => p.id === line.patientId)?.weightDate ??
        order.patients?.[0]?.weightDate,
    );

  const printBag = async (printerName?: string) => {
    try {
      const printed = await printMailOrderBagLabelDirect({
        orderNumber: mailOrderNumber,
        clientName: order.customerName,
        patientName: line.patientName || order.patientName || 'Household',
        patientWeight,
        notes: bagNotes,
      });
      setStatus(`Printed Rx and bag labels on ${printerName || printed}.`);
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Rx printed. Bag label failed: ${e.message}`
          : 'Rx printed. Could not print the bag label.',
      );
    }
  };

  return (
    <>
      <SendRxLabelButton
        className={className}
        stopClickPropagation
        source={{
          patientId: line.patientId,
          patientName: line.patientName || order.patientName || 'Patient',
          ownerName: order.customerName,
          veterinarianName: line.primaryProviderName || order.doctorName,
          quantity: line.quantity,
          name: line.name,
          strength: line.strength,
          instructions: line.scriptText || '',
          refill: line.authorizedRefills ?? line.refillsRemaining ?? 0,
          acuity: line.autoship ? 'chronic' : 'acute',
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
        onSuccess={(printerName) => {
          void printBag(printerName);
        }}
      />
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          void printBag();
        }}
      >
        Bag label only
      </button>
      {status ? <p className="settings-muted" style={{ margin: '6px 0 0', width: '100%' }}>{status}</p> : null}
      {error ? <p className="mail-queue__danger-text">{error}</p> : null}
    </>
  );
}
