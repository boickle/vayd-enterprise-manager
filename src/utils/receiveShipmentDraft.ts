import type { ParsedInvoiceLine } from '../api/inventoryOps';
import {
  decodeJwtPayload,
  resolveEmployeeIdFromToken,
} from './practiceIdFromToken';

export type ReceiveShipmentDraft = {
  branchId: number | null;
  supplierId: number | null;
  invoiceNumber: string;
  defaultLocId: number | null;
  shipmentId: number | null;
  parsedLines: ParsedInvoiceLine[];
  parseMeta: {
    supplierName: string | null;
    shipToName: string | null;
    shipToAddress: string | null;
  } | null;
  invoiceFileName: string | null;
  savedAt: string;
};

function storageKey(practiceId: number, token: string | null): string {
  let userKey = 'anonymous';
  if (token) {
    const employeeId = resolveEmployeeIdFromToken(token);
    if (employeeId != null) userKey = `emp-${employeeId}`;
    else {
      const p = decodeJwtPayload(token);
      const sub = p?.sub ?? p?.userId ?? p?.user_id;
      if (sub != null) userKey = String(sub);
    }
  }
  return `scout.receiveShipment.${practiceId}.${userKey}`;
}

function hasWork(draft: ReceiveShipmentDraft): boolean {
  return (
    draft.invoiceNumber.trim().length > 0 ||
    draft.parsedLines.length > 0 ||
    draft.shipmentId != null
  );
}

export function loadReceiveShipmentDraft(
  practiceId: number,
  token: string | null
): ReceiveShipmentDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(practiceId, token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReceiveShipmentDraft>;
    if (!parsed || typeof parsed !== 'object') return null;
    const draft: ReceiveShipmentDraft = {
      branchId:
        parsed.branchId != null && Number.isFinite(Number(parsed.branchId))
          ? Number(parsed.branchId)
          : null,
      supplierId:
        parsed.supplierId != null && Number.isFinite(Number(parsed.supplierId))
          ? Number(parsed.supplierId)
          : null,
      invoiceNumber: typeof parsed.invoiceNumber === 'string' ? parsed.invoiceNumber : '',
      defaultLocId:
        parsed.defaultLocId != null && Number.isFinite(Number(parsed.defaultLocId))
          ? Number(parsed.defaultLocId)
          : null,
      shipmentId:
        parsed.shipmentId != null && Number.isFinite(Number(parsed.shipmentId))
          ? Number(parsed.shipmentId)
          : null,
      parsedLines: Array.isArray(parsed.parsedLines) ? parsed.parsedLines : [],
      parseMeta:
        parsed.parseMeta && typeof parsed.parseMeta === 'object'
          ? {
              supplierName:
                typeof parsed.parseMeta.supplierName === 'string'
                  ? parsed.parseMeta.supplierName
                  : null,
              shipToName:
                typeof parsed.parseMeta.shipToName === 'string'
                  ? parsed.parseMeta.shipToName
                  : null,
              shipToAddress:
                typeof parsed.parseMeta.shipToAddress === 'string'
                  ? parsed.parseMeta.shipToAddress
                  : null,
            }
          : null,
      invoiceFileName:
        typeof parsed.invoiceFileName === 'string' ? parsed.invoiceFileName : null,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
    return hasWork(draft) ? draft : null;
  } catch {
    return null;
  }
}

export function saveReceiveShipmentDraft(
  practiceId: number,
  token: string | null,
  draft: Omit<ReceiveShipmentDraft, 'savedAt'>
): void {
  if (!hasWork({ ...draft, savedAt: new Date().toISOString() })) {
    clearReceiveShipmentDraft(practiceId, token);
    return;
  }
  try {
    localStorage.setItem(
      storageKey(practiceId, token),
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() })
    );
  } catch {
    // localStorage full or unavailable
  }
}

export function clearReceiveShipmentDraft(practiceId: number, token: string | null): void {
  try {
    localStorage.removeItem(storageKey(practiceId, token));
  } catch {
    // ignore
  }
}
