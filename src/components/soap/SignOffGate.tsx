// src/components/soap/SignOffGate.tsx
// Sign & lock controls that follow who may sign (EMR-07, owner decision D2).
import { CheckCircle2, Lock } from 'lucide-react';
import type { SoapEncounterMode } from '../../api/visitWorkflow';
import { usePermissions } from '../../permissions/PermissionContext';
import { signOffBlockReasonForAll } from '../../utils/recordSignOff';

/** Why the signed-in person can't sign these records, or null. */
export function useSignOffBlock(
  modes: Array<SoapEncounterMode | null | undefined>,
): string | null {
  const perms = usePermissions();
  return signOffBlockReasonForAll(perms, modes);
}

/** A short note for screens that lead to signing (the SOAP page); renders nothing for a signer. */
export function SignOffNotice({
  mode,
  className,
}: {
  mode: SoapEncounterMode | null | undefined;
  className?: string;
}) {
  const reason = useSignOffBlock([mode]);
  if (!reason) return null;
  return (
    <span className={className ?? 'soap-signoff-note'} role="note" data-testid="sign-off-notice">
      <Lock size={12} /> {reason}
    </span>
  );
}

/**
 * The wrap-up's "Sign & lock SOAP" button. Disabled with the reason when this person may not
 * sign one of the records; otherwise disabled only by `notReadyReason` (weight, doses, recap).
 */
export default function SignAndLockButton({
  modes,
  notReadyReason,
  readyTitle,
  completing,
  onClick,
  label = 'Sign & lock SOAP',
}: {
  modes: Array<SoapEncounterMode | null | undefined>;
  /** Set while something else must be done first. */
  notReadyReason: string | null;
  readyTitle: string;
  completing: boolean;
  onClick: () => void;
  label?: string;
}) {
  const blocked = useSignOffBlock(modes);
  return (
    <>
      <button
        type="button"
        className="soap-btn primary"
        disabled={Boolean(blocked) || Boolean(notReadyReason) || completing}
        title={blocked ?? notReadyReason ?? readyTitle}
        onClick={onClick}
      >
        <CheckCircle2 size={15} /> {completing ? 'Signing…' : label}
      </button>
      {blocked && (
        <span className="soap-signoff-note" role="note" data-testid="sign-off-notice">
          <Lock size={12} /> {blocked}
        </span>
      )}
    </>
  );
}
