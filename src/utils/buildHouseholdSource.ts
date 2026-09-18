import type { PatientPrescription, PatientProblem, VisitInvoice } from '../api/visitWorkflow';

export type HouseholdPetSourceInput = {
  id: string;
  name: string;
  summaryLine: string;
  alerts: string | null;
  active: boolean;
  problems: PatientProblem[];
  prescriptions: PatientPrescription[];
};

function money(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

function invoiceDue(inv: VisitInvoice): number {
  return Math.max(0, Number(inv.total || 0) - Number(inv.amountPaid || 0));
}

/**
 * Compact household source for client summary/chat — pets in this household only
 * plus account balance and Scout invoices.
 */
export function buildHouseholdSourceText(opts: {
  clientName: string;
  clientId: string;
  balance: number | null;
  pets: HouseholdPetSourceInput[];
  invoices: VisitInvoice[];
}): string {
  const lines: string[] = [];
  lines.push(`Household: ${opts.clientName.trim() || 'Client'} (clientId ${opts.clientId})`);
  lines.push(`Pets in this household only: ${opts.pets.length}`);
  lines.push('');

  lines.push('Account:');
  if (opts.balance == null || !Number.isFinite(opts.balance)) {
    lines.push('- Balance: not listed');
  } else if (Math.abs(opts.balance) < 0.005) {
    lines.push('- Balance: $0.00');
  } else if (opts.balance > 0) {
    lines.push(`- Balance due: ${money(opts.balance)}`);
  } else {
    lines.push(`- Credit on account: ${money(Math.abs(opts.balance))}`);
  }

  const invoices = (opts.invoices ?? [])
    .filter((inv) => !inv.isDeleted && inv.status !== 'void')
    .slice(0, 40);
  if (invoices.length === 0) {
    lines.push('- Scout invoices: none listed');
  } else {
    lines.push('- Scout invoices (most recent first):');
    for (const inv of invoices) {
      const num =
        inv.scoutInvoiceNumber != null
          ? `#${inv.scoutInvoiceNumber}`
          : inv.evetInvoiceNumber != null
            ? `eVet #${inv.evetInvoiceNumber}`
            : inv.id.slice(0, 8);
      const due = invoiceDue(inv);
      const petHint =
        inv.patientId != null
          ? ` · patientId ${inv.patientId}`
          : '';
      lines.push(
        `  - ${num} · ${inv.status} · total ${money(Number(inv.total || 0))} · paid ${money(
          Number(inv.amountPaid || 0),
        )} · due ${money(due)}${petHint}${inv.finalizedAt ? ` · finalized ${inv.finalizedAt.slice(0, 10)}` : ''}`,
      );
      const activeLines = (inv.lines ?? []).filter((l) => !l.isDeleted).slice(0, 12);
      for (const line of activeLines) {
        const who = line.patientName?.trim() || (line.patientId != null ? `patient ${line.patientId}` : '');
        lines.push(
          `      · ${line.description} × ${line.qty} @ ${money(Number(line.unitPrice || 0))} = ${money(
            Number(line.amount || 0),
          )}${who ? ` (${who})` : ''}`,
        );
      }
    }
  }

  lines.push('');
  lines.push('Pets:');
  if (opts.pets.length === 0) {
    lines.push('- No pets on this client.');
  }
  for (const pet of opts.pets) {
    lines.push('');
    lines.push(`### ${pet.name} (patientId ${pet.id})${pet.active ? '' : ' · inactive'}`);
    if (pet.summaryLine.trim()) lines.push(`Signalment / summary: ${pet.summaryLine.trim()}`);
    if (pet.alerts?.trim()) lines.push(`Patient alerts: ${pet.alerts.trim()}`);

    const openProblems = pet.problems.filter((p) => p.status !== 'resolved').slice(0, 20);
    if (openProblems.length) {
      lines.push('Active problems:');
      for (const p of openProblems) {
        lines.push(`- ${p.label}${p.kind ? ` (${p.kind})` : ''}${p.note ? ` — ${p.note}` : ''}`);
      }
    } else {
      lines.push('Active problems: none listed');
    }

    const activeRx = pet.prescriptions
      .filter((rx) => !rx.discontinuedAt)
      .slice(0, 20);
    if (activeRx.length) {
      lines.push('Active medications:');
      for (const rx of activeRx) {
      lines.push(
        `- ${rx.name}${rx.startDate ? ` · start ${String(rx.startDate).slice(0, 10)}` : ''}`,
      );
      }
    } else {
      lines.push('Active medications: none listed');
    }
  }

  return lines.join('\n').slice(0, 180_000);
}
