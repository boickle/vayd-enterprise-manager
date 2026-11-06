import type { ReactNode } from 'react';
import WasteDetailFields, { type WitnessOption } from './WasteDetailFields';
import { appPrompt } from '../../utils/appDialog';
import {
  CONTROLLED_RETURN_MESSAGE,
  OTHER_CORRECTION_REASON,
  OTHER_DISPOSAL_METHOD,
  chosenReturnLots,
  effectiveReturnReason,
  isMultiLot,
  returnDisposalMethods,
  returnLotsProblem,
  returnWasteProblem,
  type ReturnOptionsLine,
  type ReturnStockDetail,
  type WasteReasonLike,
} from './returnLineStock';

export type ReturnShelfOption = { id: number; name: string };

type Props = {
  lineId: string;
  /** Quantity being returned on this line (already above 0). */
  qty: number;
  backOnShelf: boolean;
  onBackOnShelfChange: (backOnShelf: boolean) => void;
  shelfLocationId: number | '';
  onShelfChange: (id: number | '') => void;
  locations: ReturnShelfOption[];
  /** Controlled flag and lots still standing; undefined while loading or if it could not be loaded. */
  options: ReturnOptionsLine | undefined;
  detail: ReturnStockDetail | undefined;
  onDetailChange: (next: ReturnStockDetail) => void;
  reasons: Array<WasteReasonLike & { requiresDisposalMethod?: string }>;
  methods: Array<{ code: string; label: string }>;
  witnessOptions: WitnessOption[];
  currentEmployeeId?: number | null;
};

async function explain(kind: 'reason' | 'disposal', current: string): Promise<string | null> {
  const text = await appPrompt({
    title: kind === 'reason' ? 'Explain the other correction' : 'Explain how it was disposed of',
    message:
      kind === 'reason'
        ? 'Say what this correction is for. It is saved with the waste and shows in the inventory reports.'
        : 'Say how this was disposed of. It is saved with the waste and shows in the inventory reports.',
    placeholder: kind === 'reason' ? 'Why' : 'How and where',
    defaultValue: current,
    confirmLabel: 'Save explanation',
    requireReason: true,
  });
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

/**
 * CAT-11: the stock side of returning one inventory line. Back on the shelf (never for a controlled
 * drug), which shelf, which lot(s) when the line was sold from several, and, when it is not going back
 * on the shelf, the same waste details as Waste / Adjust.
 */
export default function ReturnLineStockFields({
  lineId,
  qty,
  backOnShelf,
  onBackOnShelfChange,
  shelfLocationId,
  onShelfChange,
  locations,
  options,
  detail,
  onDetailChange,
  reasons,
  methods,
  witnessOptions,
  currentEmployeeId,
}: Props) {
  const isControlled = options?.isControlled === true;
  const lots = options?.lots ?? [];
  const multi = isMultiLot(lots);
  const chosen = multi ? chosenReturnLots(detail, lots, qty) : {};
  const lotProblem = multi ? returnLotsProblem(chosen, lots, qty) : null;
  const wasteProblem = !backOnShelf ? returnWasteProblem({ isControlled, reasons, detail }) : null;
  const set = (patch: Partial<ReturnStockDetail>) => onDetailChange({ ...detail, ...patch });
  const reasonCode = effectiveReturnReason(reasons, detail?.reasonCode);

  const lotEditor: ReactNode = multi ? (
    <fieldset className="client-fin__return-lots">
      <legend>{backOnShelf ? 'Which lot(s) go back' : 'Which lot(s) it came from'}</legend>
      {lots.map((lot) => (
        <label key={lot.inventoryLotBalanceId} className="client-fin__return-shelf">
          Lot {lot.lotNumber ?? lot.inventoryLotBalanceId}
          {lot.expirationDate ? ` (exp ${lot.expirationDate})` : ''}
          <input
            type="number"
            min={0}
            step="any"
            aria-label={`Quantity from lot ${lot.lotNumber ?? lot.inventoryLotBalanceId}`}
            value={
              detail?.lotQty && detail.lotQtyFor === qty
                ? (detail.lotQty[lot.inventoryLotBalanceId] ?? '')
                : String(chosen[lot.inventoryLotBalanceId] ?? '')
            }
            onChange={(e) => {
              const base: Record<number, string> =
                detail?.lotQty && detail.lotQtyFor === qty
                  ? { ...detail.lotQty }
                  : Object.fromEntries(Object.entries(chosen).map(([id, n]) => [id, String(n)]));
              base[lot.inventoryLotBalanceId] = e.target.value;
              set({ lotQty: base, lotQtyFor: qty });
            }}
          />
          <span className="client-fin__muted"> of {lot.standing} left</span>
        </label>
      ))}
      {lotProblem ? (
        <p role="alert" className="client-fin__muted" style={{ color: '#b91c1c', margin: '4px 0 0' }}>
          {lotProblem}
        </p>
      ) : null}
    </fieldset>
  ) : null;

  return (
    <div className="client-fin__return-stock">
      {isControlled ? (
        <p className="client-fin__muted" style={{ margin: '4px 0' }}>
          {CONTROLLED_RETURN_MESSAGE}
        </p>
      ) : (
        <label className="client-fin__return-shelf">
          <input
            type="checkbox"
            checked={backOnShelf}
            onChange={(e) => onBackOnShelfChange(e.target.checked)}
          />
          Back on the shelf
        </label>
      )}

      {backOnShelf && locations.length > 0 ? (
        <label className="client-fin__return-shelf">
          Shelf
          <select
            value={shelfLocationId}
            onChange={(e) => onShelfChange(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Where it was sold from</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {lotEditor}

      {!backOnShelf ? (
        <div className="client-fin__return-waste">
          <strong>Record as waste</strong>
          <WasteDetailFields
            idPrefix={`return-${lineId}-`}
            isControlled={isControlled}
            reasons={reasons}
            reasonCode={reasonCode}
            onReasonChange={async (code) => {
              if (code === OTHER_CORRECTION_REASON) {
                const why = await explain('reason', detail?.reasonExplanation ?? '');
                if (!why) return;
                set({ reasonCode: code, reasonExplanation: why });
              } else {
                set({ reasonCode: code });
              }
            }}
            reasonExplanation={detail?.reasonExplanation}
            showReasonExplanation={reasonCode === OTHER_CORRECTION_REASON}
            methods={returnDisposalMethods(methods)}
            disposalCode={detail?.disposalCode ?? ''}
            onDisposalChange={async (code) => {
              if (code === OTHER_DISPOSAL_METHOD) {
                const why = await explain('disposal', detail?.disposalExplanation ?? '');
                if (!why) return;
                set({ disposalCode: code, disposalExplanation: why });
              } else {
                set({ disposalCode: code });
              }
            }}
            disposalExplanation={detail?.disposalExplanation}
            showDisposalExplanation={detail?.disposalCode === OTHER_DISPOSAL_METHOD}
            notes={detail?.notes ?? ''}
            onNotesChange={(notes) => set({ notes })}
            witnessOptions={witnessOptions}
            witnessEmployeeId={detail?.witnessId ?? null}
            onWitnessChange={(witnessId) => set({ witnessId })}
            currentEmployeeId={currentEmployeeId}
          />
          {wasteProblem ? (
            <p role="alert" className="client-fin__muted" style={{ color: '#b91c1c', margin: '4px 0 0' }}>
              {wasteProblem}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
