import { DateTime } from 'luxon';
import type {
  Appointment,
  Patient,
  RoomLoaderReconciliation,
  SentStatus,
  SummaryForPdf,
  SummaryLineItem,
  TreatmentItemLine,
} from '../api/roomLoader';

/** True when every linked appointment has ended (or started) in the past. */
export function roomLoaderAppointmentsHaveHappened(appointments: Appointment[]): boolean {
  if (!appointments.length) return false;
  const now = DateTime.now();
  return appointments.every((apt) => {
    const raw = apt.appointmentEnd ?? apt.appointmentStart;
    if (!raw || typeof raw !== 'string') return false;
    const dt = DateTime.fromISO(raw);
    return dt.isValid && dt <= now;
  });
}

export function countChartTreatmentItems(data: RoomLoaderReconciliation): number {
  let count = 0;
  for (const apt of data.appointments ?? []) {
    const items = (apt.treatment as { treatmentItems?: TreatmentItemLine[] } | null | undefined)?.treatmentItems;
    if (Array.isArray(items)) count += items.length;
  }
  return count;
}

export type ChartItemType = 'inventory' | 'procedure' | 'lab' | 'prescription' | 'unknown';

export type ComparisonRowState =
  | 'matched'
  | 'price_mismatch'
  | 'agreed_only'
  | 'chart_only'
  | 'declined_agreed'
  | 'declined_chart';

export type AgreedSource = 'client' | 'proposed' | 'draft' | 'none';

export type ComparisonRow = {
  state: ComparisonRowState;
  key: string | null;
  agreed?: {
    name: string;
    code?: string;
    amount: number;
    quantity?: number;
    declined: boolean;
    raw: SummaryLineItem;
  };
  chart?: {
    name: string;
    code?: string;
    amount: number;
    quantity: number;
    declined: boolean;
    isEstimate?: boolean;
    raw: TreatmentItemLine;
  };
};

export type PetReconciliationSection = {
  patientId: number;
  patientName: string;
  isMember?: boolean;
  membershipName?: string | null;
  estimateTotal: number;
  visitTotal: number;
  matchedRows: ComparisonRow[];
  unmatchedRows: ComparisonRow[];
};

export type ReconciliationView = {
  roomLoaderId: number;
  sentStatus: SentStatus;
  agreedSource: AgreedSource;
  agreedSourceLabel: string;
  grandEstimateTotal: number;
  grandVisitTotal: number;
  pets: PetReconciliationSection[];
  hasChartEstimate: boolean;
};

const PRICE_TOLERANCE = 0.01;

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function agreedLineAmount(row: SummaryLineItem): number {
  if (row.lineTotal != null) return Number(row.lineTotal);
  if (row.price != null) return Number(row.price);
  return 0;
}

export function isAgreedDeclined(row: SummaryLineItem): boolean {
  if (row.declined === true) return true;
  if (row.crossedOut === true) return true;
  if (row.checked === false) return true;
  if (row.uncheckable === false && row.checked !== true) return true;
  return false;
}

export function chartLineAmount(item: TreatmentItemLine): number {
  const total = item.totalPrice != null ? Number(item.totalPrice) : null;
  if (total != null && total > 0) return total;
  const min = item.minimumPrice != null ? Number(item.minimumPrice) : null;
  if (min != null && min > 0) return min;
  return Number(item.price ?? 0) * Number(item.quantity ?? 1);
}

export function chartItemType(item: TreatmentItemLine): ChartItemType {
  if (item.inventoryItem) return 'inventory';
  if (item.procedure) return 'procedure';
  if (item.lab) return 'lab';
  if (item.prescriptions?.length) return 'prescription';
  return 'unknown';
}

export function chartItemKey(item: TreatmentItemLine): string | null {
  const code = item.inventoryItem?.code ?? item.procedure?.code ?? item.lab?.code ?? null;
  if (code?.trim()) return code.trim().toLowerCase();
  const id = item.inventoryItem?.id ?? item.procedure?.id ?? item.lab?.id;
  if (id != null) return `${chartItemType(item)}:${id}`;
  return null;
}

export function agreedLineKey(row: SummaryLineItem): string | null {
  if (row.code?.trim()) return row.code.trim().toLowerCase();
  const si = row.searchableItem;
  if (si?.procedure?.id) return `procedure:${si.procedure.id}`;
  if (si?.inventoryItem?.id) return `inventory:${si.inventoryItem.id}`;
  if (si?.lab?.id) return `lab:${si.lab.id}`;
  return null;
}

function chartItemName(item: TreatmentItemLine): string {
  return (
    item.procedure?.name ??
    item.inventoryItem?.name ??
    item.lab?.name ??
    item.prescriptions?.[0]?.name ??
    'Unknown item'
  );
}

function chartItemCode(item: TreatmentItemLine): string | undefined {
  return item.procedure?.code ?? item.inventoryItem?.code ?? item.lab?.code ?? undefined;
}

function agreedItemName(row: SummaryLineItem): string {
  return (row.name ?? 'Unknown item').trim();
}

function appointmentsByPatientId(appointments: Appointment[]): Map<number, Appointment[]> {
  const map = new Map<number, Appointment[]>();
  for (const a of appointments) {
    const pid = a.patient?.id;
    if (pid == null) continue;
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid)!.push(a);
  }
  return map;
}

function chartItemsForPatient(appointments: Appointment[]): TreatmentItemLine[] {
  const items: TreatmentItemLine[] = [];
  for (const appt of appointments) {
    const treatmentItems = (appt.treatment as { treatmentItems?: TreatmentItemLine[] } | null | undefined)
      ?.treatmentItems;
    if (Array.isArray(treatmentItems)) {
      items.push(...treatmentItems);
    }
  }
  return items;
}

function pickAgreedSummary(data: RoomLoaderReconciliation): {
  summary: SummaryForPdf | null;
  source: AgreedSource;
  label: string;
} {
  const status = data.sentStatus;
  if (status === 'completed' && data.responseFromClient?.summaryForPdf) {
    return {
      summary: data.responseFromClient.summaryForPdf,
      source: 'client',
      label: 'Client agreed (submitted form)',
    };
  }
  const sentSummary = (data.sentToClient as { summaryForPdf?: SummaryForPdf } | null | undefined)?.summaryForPdf;
  if (sentSummary) {
    return {
      summary: sentSummary,
      source: 'proposed',
      label: 'Proposed (sent to client, not yet submitted)',
    };
  }
  const savedSummary = (data.savedForm as { summaryForPdf?: SummaryForPdf } | null | undefined)?.summaryForPdf;
  if (savedSummary) {
    return {
      summary: savedSummary,
      source: 'draft',
      label: 'Staff draft (not client-signed)',
    };
  }
  return { summary: null, source: 'none', label: 'No client agreement on file' };
}

function sumAcceptedAgreedRows(rows: SummaryLineItem[]): number {
  return rows.reduce((sum, row) => (isAgreedDeclined(row) ? sum : sum + agreedLineAmount(row)), 0);
}

function sumAcceptedChartItems(items: TreatmentItemLine[]): number {
  return items.reduce((sum, item) => (item.isDeclined ? sum : sum + chartLineAmount(item)), 0);
}

function buildPetComparison(
  patientId: number,
  patientName: string,
  agreedRows: SummaryLineItem[],
  chartItems: TreatmentItemLine[],
  isEstimate: boolean
): { matchedRows: ComparisonRow[]; unmatchedRows: ComparisonRow[]; estimateTotal: number; visitTotal: number } {
  const agreedByKey = new Map<string, SummaryLineItem[]>();
  const agreedNoKey: SummaryLineItem[] = [];
  for (const row of agreedRows) {
    const key = agreedLineKey(row);
    if (key) {
      if (!agreedByKey.has(key)) agreedByKey.set(key, []);
      agreedByKey.get(key)!.push(row);
    } else {
      agreedNoKey.push(row);
    }
  }

  const chartByKey = new Map<string, TreatmentItemLine[]>();
  const chartNoKey: TreatmentItemLine[] = [];
  for (const item of chartItems) {
    const key = chartItemKey(item);
    if (key) {
      if (!chartByKey.has(key)) chartByKey.set(key, []);
      chartByKey.get(key)!.push(item);
    } else {
      chartNoKey.push(item);
    }
  }

  const matchedRows: ComparisonRow[] = [];
  const unmatchedRows: ComparisonRow[] = [];
  const usedChartIds = new Set<number>();

  const allKeys = new Set([...agreedByKey.keys(), ...chartByKey.keys()]);
  for (const key of allKeys) {
    const agreedList = agreedByKey.get(key) ?? [];
    const chartList = chartByKey.get(key) ?? [];
    const agreed = agreedList[0];
    const chart = chartList[0];
    if (chart) usedChartIds.add(chart.id);

    if (agreed && chart) {
      const agreedDeclined = isAgreedDeclined(agreed);
      const chartDeclined = chart.isDeclined;
      let state: ComparisonRowState = 'matched';
      if (agreedDeclined && !chartDeclined) state = 'declined_agreed';
      else if (!agreedDeclined && chartDeclined) state = 'declined_chart';
      else if (!agreedDeclined && !chartDeclined) {
        const aAmt = agreedLineAmount(agreed);
        const cAmt = chartLineAmount(chart);
        if (Math.abs(aAmt - cAmt) > PRICE_TOLERANCE) state = 'price_mismatch';
      }
      const row: ComparisonRow = {
        state,
        key,
        agreed: {
          name: agreedItemName(agreed),
          code: agreed.code,
          amount: agreedLineAmount(agreed),
          quantity: agreed.quantity,
          declined: agreedDeclined,
          raw: agreed,
        },
        chart: {
          name: chartItemName(chart),
          code: chartItemCode(chart),
          amount: chartLineAmount(chart),
          quantity: chart.quantity,
          declined: chartDeclined,
          isEstimate,
          raw: chart,
        },
      };
      if (state === 'matched' || state === 'declined_agreed' || state === 'declined_chart') {
        matchedRows.push(row);
      } else {
        unmatchedRows.push(row);
      }
    } else if (agreed) {
      const agreedDeclined = isAgreedDeclined(agreed);
      const row: ComparisonRow = {
        state: agreedDeclined ? 'declined_agreed' : 'agreed_only',
        key,
        agreed: {
          name: agreedItemName(agreed),
          code: agreed.code,
          amount: agreedLineAmount(agreed),
          quantity: agreed.quantity,
          declined: agreedDeclined,
          raw: agreed,
        },
      };
      if (agreedDeclined) matchedRows.push(row);
      else unmatchedRows.push(row);
    } else if (chart) {
      const row: ComparisonRow = {
        state: chart.isDeclined ? 'declined_chart' : 'chart_only',
        key,
        chart: {
          name: chartItemName(chart),
          code: chartItemCode(chart),
          amount: chartLineAmount(chart),
          quantity: chart.quantity,
          declined: chart.isDeclined,
          isEstimate,
          raw: chart,
        },
      };
      if (chart.isDeclined) matchedRows.push(row);
      else unmatchedRows.push(row);
    }
  }

  for (const row of agreedNoKey) {
    const agreedDeclined = isAgreedDeclined(row);
    const cmp: ComparisonRow = {
      state: agreedDeclined ? 'declined_agreed' : 'agreed_only',
      key: null,
      agreed: {
        name: agreedItemName(row),
        code: row.code,
        amount: agreedLineAmount(row),
        quantity: row.quantity,
        declined: agreedDeclined,
        raw: row,
      },
    };
    if (agreedDeclined) matchedRows.push(cmp);
    else unmatchedRows.push(cmp);
  }

  for (const item of chartNoKey) {
    if (usedChartIds.has(item.id)) continue;
    const cmp: ComparisonRow = {
      state: item.isDeclined ? 'declined_chart' : 'chart_only',
      key: null,
      chart: {
        name: chartItemName(item),
        code: chartItemCode(item),
        amount: chartLineAmount(item),
        quantity: item.quantity,
        declined: item.isDeclined,
        isEstimate,
        raw: item,
      },
    };
    if (item.isDeclined) matchedRows.push(cmp);
    else unmatchedRows.push(cmp);
  }

  const estimateTotal = sumAcceptedAgreedRows(agreedRows);
  const visitTotal = sumAcceptedChartItems(chartItems);

  return { matchedRows, unmatchedRows, estimateTotal, visitTotal };
}

export function buildReconciliationView(data: RoomLoaderReconciliation): ReconciliationView {
  const { summary, source, label } = pickAgreedSummary(data);
  const apptByPatient = appointmentsByPatientId(data.appointments ?? []);
  const patientList = data.patients ?? [];
  const summaryPets = summary?.pets ?? [];

  const petIdsFromSummary = summaryPets.map((p) => p.patientId ?? p.id).filter((id): id is number => id != null);
  const allPetIds = new Set<number>([
    ...patientList.map((p) => p.id),
    ...petIdsFromSummary,
    ...Array.from(apptByPatient.keys()),
  ]);

  let hasChartEstimate = false;
  const pets: PetReconciliationSection[] = [];

  for (const patientId of allPetIds) {
    const patient =
      patientList.find((p: Patient) => p.id === patientId) ??
      data.appointments?.find((a) => a.patient?.id === patientId)?.patient;
    const summaryPet = summaryPets.find((p) => (p.patientId ?? p.id) === patientId);
    const patientName =
      patient?.name ?? summaryPet?.patientName ?? `Patient #${patientId}`;

    const agreedRows: SummaryLineItem[] = [...(summaryPet?.rows ?? [])];
    const appts = apptByPatient.get(patientId) ?? [];
    const chartItems = chartItemsForPatient(appts);
    const isEstimate = appts.some(
      (a) => (a.treatment as { isEstimate?: boolean } | null | undefined)?.isEstimate === true
    );
    if (isEstimate) hasChartEstimate = true;

    const { matchedRows, unmatchedRows, estimateTotal, visitTotal } = buildPetComparison(
      patientId,
      patientName,
      agreedRows,
      chartItems,
      isEstimate
    );

    pets.push({
      patientId,
      patientName,
      isMember: patient?.isMember,
      membershipName: patient?.membershipName,
      estimateTotal: summaryPet?.subtotal != null ? Number(summaryPet.subtotal) : estimateTotal,
      visitTotal,
      matchedRows,
      unmatchedRows,
    });
  }

  pets.sort((a, b) => a.patientName.localeCompare(b.patientName));

  const additionalItems = summary?.additionalItems?.items?.filter((it) => it.declined !== true) ?? [];
  const additionalEstimate = additionalItems.reduce((s, row) => s + agreedLineAmount(row), 0);
  const grandEstimateTotal =
    (summary?.grandTotal != null ? Number(summary.grandTotal) : null) ??
    pets.reduce((s, p) => s + p.estimateTotal, 0) + additionalEstimate;
  const grandVisitTotal = pets.reduce((s, p) => s + p.visitTotal, 0);

  if (additionalItems.length > 0) {
    const householdRows = buildPetComparison(
      0,
      summary?.additionalItems?.label ?? 'Additional items',
      additionalItems,
      [],
      false
    );
    pets.push({
      patientId: 0,
      patientName: summary?.additionalItems?.label ?? 'Additional items',
      estimateTotal: summary?.additionalItems?.subtotal != null
        ? Number(summary.additionalItems.subtotal) + (summary.additionalItems.tax ?? 0)
        : householdRows.estimateTotal,
      visitTotal: 0,
      matchedRows: householdRows.matchedRows,
      unmatchedRows: householdRows.unmatchedRows,
    });
  }

  return {
    roomLoaderId: data.id,
    sentStatus: data.sentStatus,
    agreedSource: source,
    agreedSourceLabel: label,
    grandEstimateTotal,
    grandVisitTotal,
    pets,
    hasChartEstimate,
  };
}

export function comparisonStateLabel(state: ComparisonRowState): string {
  switch (state) {
    case 'matched':
      return 'Matched';
    case 'price_mismatch':
      return 'Price mismatch';
    case 'agreed_only':
      return 'On estimate only';
    case 'chart_only':
      return 'On visit only';
    case 'declined_agreed':
      return 'Declined on estimate';
    case 'declined_chart':
      return 'Declined on visit';
    default:
      return state;
  }
}
