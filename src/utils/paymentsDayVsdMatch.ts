import type { ReconciliationClient, PaymentDayRow } from '../api/payments';
import type { ClientRevenueSeriesResponse } from '../api/opsStats';

const MONEY_EPS = 0.01;

/** How far back to query client treatment history when matching a payment day. */
export const CLIENT_VSD_LOOKBACK_DAYS = 90;

export function reconciliationClientLabel(c?: ReconciliationClient): string {
  if (!c) return '—';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '—';
}

export type LatestTreatmentPatient = {
  patientName: string;
  isMember: boolean;
};

export type LatestTreatmentVsd = {
  amount: number | null;
  treatmentDate: string | null;
  /** Patients on treatment items for the latest treatment day. */
  patients: LatestTreatmentPatient[];
};

/**
 * VSD for the client's most recent treatment day on or before `asOfDate`
 * (sum of treatment items on that day).
 */
export function vsdFromLatestTreatment(
  response: ClientRevenueSeriesResponse | null | undefined,
  asOfDate: string
): LatestTreatmentVsd {
  const asOf = asOfDate.slice(0, 10);
  const points = (response?.series ?? [])
    .filter((p) => {
      const d = String(p.date).slice(0, 10);
      return d <= asOf && (p.items?.length ?? 0) > 0;
    })
    .sort((a, b) =>
      String(b.date).slice(0, 10).localeCompare(String(a.date).slice(0, 10))
    );

  const latest = points[0];
  if (!latest?.items?.length) {
    return {
      amount: null,
      treatmentDate: null,
      patients: [],
    };
  }

  const items = latest.items;
  const patientMember = new Map<string, boolean>();
  for (const item of items) {
    const name = (item.patientName ?? '').trim() || '—';
    const prev = patientMember.get(name);
    patientMember.set(name, prev === true || item.isMember === true);
  }
  const patients: LatestTreatmentPatient[] = [...patientMember.entries()].map(
    ([patientName, isMember]) => ({ patientName, isMember })
  );

  const amount = items.reduce((sum, i) => sum + Number(i.cost ?? 0), 0);
  return {
    amount,
    treatmentDate: String(latest.date).slice(0, 10),
    patients,
  };
}

export type PaymentDetailTableRow = {
  payment: PaymentDayRow;
  clientId: number | null;
  clientName: string;
  /** Patients on the latest treatment day used for VSD. */
  treatmentPatients: LatestTreatmentPatient[];
  vsdAmount: number | null;
  latestTreatmentDate: string | null;
  matchesVsd: boolean | null;
};

export function buildPaymentDetailRows(
  payments: PaymentDayRow[],
  clientRevenueById: Map<number, ClientRevenueSeriesResponse>,
  asOfDate: string
): PaymentDetailTableRow[] {
  return payments.map((payment) => {
    const clientId = payment.client?.id != null ? Number(payment.client.id) : null;
    const clientName = reconciliationClientLabel(payment.client);
    const revenue =
      clientId != null && Number.isFinite(clientId)
        ? clientRevenueById.get(clientId)
        : undefined;
    const {
      amount: vsdAmount,
      treatmentDate: latestTreatmentDate,
      patients: treatmentPatients,
    } = vsdFromLatestTreatment(revenue, asOfDate);
    const matchesVsd =
      vsdAmount == null ? null : Math.abs(Number(payment.amount) - vsdAmount) <= MONEY_EPS;

    return {
      payment,
      clientId,
      clientName,
      treatmentPatients,
      vsdAmount,
      latestTreatmentDate,
      matchesVsd,
    };
  });
}
