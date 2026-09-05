import { useEffect, useRef, useState } from 'react';
import {
  getEmployeeBranches,
  listPracticeBranches,
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
  onInvoiceChange,
  className,
  fieldClassName,
  selectClassName,
}: Props) {
  const { employeeId } = useAuth();
  const empId =
    employeeId != null && Number.isFinite(Number(employeeId)) ? Number(employeeId) : null;
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [fallbackBranchId, setFallbackBranchId] = useState<number | null>(null);
  const seededFor = useRef<string | null>(null);

  const locked =
    invoice == null ||
    invoice.status === 'paid' ||
    invoice.status === 'void' ||
    invoice.status === 'finalized';

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
          const fresh = await patchVisitInvoice(invoice.id, {
            inventoryBranchId: nextDefault,
          });
          if (!canceled) onInvoiceChange(fresh);
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

  if (!invoice) return null;

  const selected =
    invoice.inventoryBranchId ?? fallbackBranchId ?? '';

  const onChange = async (raw: string) => {
    const next = Number(raw);
    if (!Number.isFinite(next) || next === invoice.inventoryBranchId) return;
    try {
      onInvoiceChange(await patchVisitInvoice(invoice.id, { inventoryBranchId: next }));
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
          value={selected === '' ? '' : String(selected)}
          disabled={disabled || locked || branches.length === 0}
          onChange={(e) => void onChange(e.target.value)}
        >
          {selected === '' ? <option value="">Select branch…</option> : null}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
