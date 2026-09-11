import { useEffect, useRef, useState } from 'react';
import {
  getEmployeeBranches,
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../../api/branchInventory';
import {
  patchVisitInvoice,
  VISIT_WORKFLOW_PRACTICE_ID,
  type VisitInvoice,
} from '../../api/visitWorkflow';
import { useAuth } from '../../auth/useAuth';

type Props = {
  invoice: VisitInvoice | null;
  disabled?: boolean;
  /** Persist branch/location to the server. Leave off for unsaved drafts. */
  persist?: boolean;
  onInvoiceChange: (invoice: VisitInvoice) => void;
  className?: string;
  fieldClassName?: string;
  selectClassName?: string;
};

function employeeDefaultBranchId(
  assignments: { branchId: number; isPrimary: boolean }[],
  branches: PracticeBranch[]
): number | null {
  return (
    assignments.find((a) => a.isPrimary)?.branchId ??
    assignments[0]?.branchId ??
    branches.find((b) => b.isDefault)?.id ??
    branches[0]?.id ??
    null
  );
}

/**
 * Office checkout draws stock from. Defaults to the signed-in employee’s
 * primary branch (Settings → employee → Default inventory) and persists on
 * the invoice so finalize decrements the right location.
 */
export default function CheckoutInventoryBranchField({
  invoice,
  disabled,
  persist = true,
  onInvoiceChange,
  className,
  fieldClassName,
  selectClassName,
}: Props) {
  const { employeeId } = useAuth();
  const empId =
    employeeId != null && Number.isFinite(Number(employeeId)) ? Number(employeeId) : null;
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [fallbackBranchId, setFallbackBranchId] = useState<number | null>(null);
  const seededFor = useRef<string | null>(null);

  const locked =
    invoice == null ||
    invoice.status === 'paid' ||
    invoice.status === 'void' ||
    invoice.status === 'finalized';

  const branchId = invoice?.inventoryBranchId ?? fallbackBranchId ?? null;

  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const [officeList, assignments] = await Promise.all([
          listPracticeBranches(VISIT_WORKFLOW_PRACTICE_ID),
          empId != null
            ? getEmployeeBranches(VISIT_WORKFLOW_PRACTICE_ID, empId).catch(() => [])
            : Promise.resolve([]),
        ]);
        if (canceled) return;
        const active = officeList.filter((b) => b.isActive !== false);
        setBranches(active);
        const nextDefault = employeeDefaultBranchId(assignments, active);
        setFallbackBranchId(nextDefault);
        if (
          invoice &&
          !locked &&
          invoice.inventoryBranchId == null &&
          nextDefault != null &&
          seededFor.current !== invoice.id
        ) {
          seededFor.current = invoice.id;
          if (!persist) {
            if (!canceled) onInvoiceChange({ ...invoice, inventoryBranchId: nextDefault });
          } else {
            const fresh = await patchVisitInvoice(invoice.id, {
              inventoryBranchId: nextDefault,
            });
            if (!canceled) onInvoiceChange(fresh);
          }
        }
      } catch {
        if (!canceled) setBranches([]);
      }
    })();
    return () => {
      canceled = true;
    };
    // Seed once per invoice; parent updates inventoryBranchId via onInvoiceChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, empId, locked]);

  useEffect(() => {
    let canceled = false;
    if (branchId == null) {
      setLocations([]);
      return;
    }
    void listInventoryBranchLocations(VISIT_WORKFLOW_PRACTICE_ID, branchId)
      .then((rows) => {
        if (!canceled) setLocations(rows.filter((loc) => loc.isActive !== false));
      })
      .catch(() => {
        if (!canceled) setLocations([]);
      });
    return () => {
      canceled = true;
    };
  }, [branchId]);

  if (!invoice) return null;

  const selectedBranch = invoice.inventoryBranchId ?? fallbackBranchId ?? '';
  const selectedLocation = invoice.inventoryLocationId ?? '';

  const onBranchChange = async (raw: string) => {
    const next = Number(raw);
    if (!Number.isFinite(next) || next === invoice.inventoryBranchId) return;
    try {
      if (!persist) {
        onInvoiceChange({ ...invoice, inventoryBranchId: next, inventoryLocationId: null });
        return;
      }
      onInvoiceChange(await patchVisitInvoice(invoice.id, { inventoryBranchId: next }));
    } catch {
      /* parent checkout panel surfaces API errors on pay */
    }
  };

  const onLocationChange = async (raw: string) => {
    const next = raw === '' ? null : Number(raw);
    if (next != null && !Number.isFinite(next)) return;
    if (next === invoice.inventoryLocationId) return;
    try {
      if (!persist) {
        onInvoiceChange({ ...invoice, inventoryLocationId: next });
        return;
      }
      onInvoiceChange(await patchVisitInvoice(invoice.id, { inventoryLocationId: next }));
    } catch {
      /* parent checkout panel surfaces API errors on pay */
    }
  };

  return (
    <div className={className}>
      <label className={fieldClassName}>
        Branch
        <select
          className={selectClassName}
          value={selectedBranch === '' ? '' : String(selectedBranch)}
          disabled={disabled || locked || branches.length === 0}
          onChange={(e) => void onBranchChange(e.target.value)}
        >
          {selectedBranch === '' ? <option value="">Select branch…</option> : null}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldClassName}>
        Location *
        <select
          className={selectClassName}
          required
          aria-required="true"
          value={selectedLocation === '' ? '' : String(selectedLocation)}
          disabled={disabled || locked || selectedBranch === '' || locations.length === 0}
          onChange={(e) => void onLocationChange(e.target.value)}
        >
          <option value="">{locations.length ? 'Select location…' : 'No locations'}</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
              {loc.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
