// Care plan / summary rows: “Why we recommend this” when a line is crossed out or covered by a panel.
import type {
  RoomLoaderDeclineReason,
  RoomLoaderItemRef,
  RoomLoaderPanelOption,
} from '../../utils/roomLoaderConfigTypes';
import RoomLoaderHtml from './RoomLoaderHtml';

const FOUR_DX_UNCHECK_INFO_CODES = new Set(['F4DX']);
const FECAL_UNCHECK_INFO_CODES = new Set(['FIL5010', 'FIL24639']);
const LYME_UNCHECK_INFO_CODES = new Set(['LYMECR', 'LYMECRINITIAL']);
const LEPTO_UNCHECK_INFO_CODES = new Set(['LEPTOANNUAL', 'LEPTOINIT']);
const BORDETELLA_UNCHECK_INFO_CODES = new Set(['BORDORAL']);
const FVRCP_UNCHECK_INFO_CODES = new Set(['FVRCPBOOST', 'FVRCP1', 'FVRCP3', 'FVRCPBOOSTER2']);
const FELV_UNCHECK_INFO_CODES = new Set(['FELV1', 'FELV2', 'FELVINIT']);
const RABIES_UNCHECK_INFO_CODES = new Set([
  'RABIESFEL1',
  'RABIESPUREVAX1',
  'RABIESPUREVAX3',
  'RABIES1',
  'RABIES3',
]);

export function carePlanRowCode(row: {
  code?: string | null;
  searchableItem?: unknown;
}): string {
  const direct = (row.code ?? '').trim().toUpperCase();
  if (direct) return direct;
  const si = row.searchableItem as {
    lab?: { code?: string };
    procedure?: { code?: string };
    inventoryItem?: { code?: string };
  } | null;
  return (
    si?.lab?.code ??
    si?.procedure?.code ??
    si?.inventoryItem?.code ??
    ''
  )
    .trim()
    .toUpperCase();
}

export function displayRowMatchesItemRef(
  row: {
    itemType?: string | null;
    type?: string | null;
    id?: number | null;
    code?: string | null;
    searchableItem?: unknown;
  },
  ref: RoomLoaderItemRef
): boolean {
  const itemType = String(row.itemType ?? row.type ?? '').toLowerCase();
  if (row.id != null && Number(ref.itemId) === Number(row.id) && ref.itemType === itemType) {
    return true;
  }
  const code = carePlanRowCode(row);
  const refCode = (ref.code ?? '').trim().toUpperCase();
  return refCode !== '' && code === refCode;
}

/** Configured sub-ask copy when an accepted panel already covers this estimate line. */
export function replacedEstimateLineWhyHtml(
  row: {
    itemType?: string | null;
    type?: string | null;
    id?: number | null;
    code?: string | null;
    searchableItem?: unknown;
  },
  acceptedPanelOptions: RoomLoaderPanelOption[]
): string | null {
  for (const option of acceptedPanelOptions) {
    const coversLine = option.replacesItems.some((ref) => displayRowMatchesItemRef(row, ref));
    if (!coversLine) continue;
    const sub = option.subAsks.find((ask) => displayRowMatchesItemRef(row, ask.item));
    const html = (sub?.cautionHtml ?? '').trim();
    if (html) return html;
    for (const ref of option.replacesItems) {
      if (!displayRowMatchesItemRef(row, ref)) continue;
      const byRef = option.subAsks.find(
        (ask) =>
          ask.item.itemType === ref.itemType &&
          Number(ask.item.itemId) === Number(ref.itemId)
      );
      const alt = (byRef?.cautionHtml ?? '').trim();
      if (alt) return alt;
    }
  }
  return null;
}

/**
 * Practice-configured “why we recommend this” for an unchecked row. Takes precedence
 * over {@link carePlanUncheckRecommendationBody}, which stays as the built-in copy for
 * practices that have not written their own.
 */
export function configuredUncheckRecommendationHtml(
  row: {
    itemType?: string | null;
    type?: string | null;
    id?: number | null;
    code?: string | null;
    searchableItem?: unknown;
  },
  reasons: RoomLoaderDeclineReason[] | undefined
): string | null {
  for (const reason of reasons ?? []) {
    const html = (reason.html ?? '').trim();
    if (!html) continue;
    if ((reason.items ?? []).some((ref) => displayRowMatchesItemRef(row, ref))) return html;
  }
  return null;
}

export function carePlanUncheckRecommendationBody(code: string | null | undefined): string | null {
  const c = (code ?? '').trim().toUpperCase();
  if (!c) return null;
  if (LYME_UNCHECK_INFO_CODES.has(c)) {
    return 'Lyme disease is extremely common in our area due to the high number of ticks. Because of this risk, Vet At Your Door considers the Lyme vaccine a core vaccine for dogs to help prevent painful joint disease and rare but serious kidney complications.';
  }
  if (LEPTO_UNCHECK_INFO_CODES.has(c)) {
    return 'Leptospirosis is a serious bacterial infection that dogs can contract from water contaminated with wildlife urine, such as puddles or streams. Because it can be life-threatening for dogs and can also spread to humans, Vet At Your Door considers the Leptospirosis vaccine a core vaccine for dogs.';
  }
  if (BORDETELLA_UNCHECK_INFO_CODES.has(c)) {
    return 'Bordetella ("kennel cough") is a contagious respiratory infection that spreads easily anywhere dogs gather, such as boarding facilities, daycare, grooming, or training classes. This vaccine helps protect dogs who have contact with other dogs and reduces the risk of infection.';
  }
  if (FVRCP_UNCHECK_INFO_CODES.has(c)) {
    return 'FVRCP protects cats against three serious viral diseases: feline viral rhinotracheitis, calicivirus, and panleukopenia. Because these infections are common and can cause severe illness, Vet At Your Door considers FVRCP a core vaccine for all indoor and outdoor cats.';
  }
  if (FELV_UNCHECK_INFO_CODES.has(c)) {
    return "Feline Leukemia Virus (FeLV) is a contagious virus that weakens a cat's immune system and can lead to serious illness. We recommend this vaccine for all cats under one year of age, as well as adult cats that go outdoors or live with cats who have outdoor exposure.";
  }
  if (RABIES_UNCHECK_INFO_CODES.has(c)) {
    return 'Rabies is a fatal viral disease that can affect both animals and humans and is transmitted through bites from infected wildlife. Because of this risk, rabies vaccination is required by law and is considered a core vaccine for all dogs and cats.';
  }
  if (FOUR_DX_UNCHECK_INFO_CODES.has(c)) {
    return 'The 4Dx test screens for heartworm disease and common tick-borne infections such as Lyme, Anaplasma, and Ehrlichia. Because heartworm disease can be serious and prevention medications require a current negative heartworm test for safe prescribing, we recommend this screening annually.';
  }
  if (FECAL_UNCHECK_INFO_CODES.has(c)) {
    return 'A fecal test screens for intestinal parasites such as roundworms, hookworms, whipworms, and giardia. Because these parasites are common and some can spread to people, we recommend periodic screening to detect infections early and treat them appropriately.';
  }
  return null;
}

type BlurbProps = {
  html?: string | null;
  plainBody?: string | null;
};

export function CarePlanWhyRecommendBlurb({ html, plainBody }: BlurbProps) {
  const hasHtml = (html ?? '').trim() !== '';
  const hasPlain = (plainBody ?? '').trim() !== '';
  if (!hasHtml && !hasPlain) return null;
  return (
    <div className="rl-caution" style={{ marginLeft: '30px' }}>
      <div>
        <strong className="rl-caution__title">Why we recommend this</strong>
        {hasHtml ? (
          <RoomLoaderHtml html={html!} />
        ) : (
          <p style={{ margin: 0 }}>{plainBody}</p>
        )}
      </div>
    </div>
  );
}
