/** Same text the API writes on a pre-visit line priced from the check-in form (no catalog match). */
export const CHECKIN_FORM_PRICE_NOTE =
  'Priced from the check-in form (no catalog match). Check the price before accepting.';

export function hasCheckinFormPriceNote(note: string | null | undefined): boolean {
  return !!note && note.includes('Priced from the check-in form');
}

/** Shown under a pre-visit accept row (not a declined one, which shows its decline reason instead). */
export function PrevisitCheckinPriceNote({
  note,
  state,
}: {
  note: string | null | undefined;
  state?: string | null;
}) {
  if (state === 'declined' || !hasCheckinFormPriceNote(note)) return null;
  return (
    <div className="soap-invoice-previsit-reason" data-testid="previsit-checkin-price-note">
      {note!.trim()}
    </div>
  );
}
