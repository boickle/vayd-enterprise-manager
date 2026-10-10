// src/utils/roomLoaderOfferEngine.ts
// Decides what the client Room Loader asks each pet, from the practice's Room Loader
// settings rather than hardcoded catalog codes. Every function here is pure so the
// rules can be exercised without a browser.
import { DateTime } from 'luxon';
import {
  roomLoaderItemKey,
  type RoomLoaderAgeWindow,
  type RoomLoaderConfig,
  type RoomLoaderGatedOffer,
  type RoomLoaderHistoryGate,
  type RoomLoaderItemQuestion,
  type RoomLoaderItemRef,
  type RoomLoaderItemType,
  type RoomLoaderPanelOption,
  type RoomLoaderPanelRule,
  type RoomLoaderPanelSubAsk,
  type RoomLoaderSampleInstruction,
  type RoomLoaderSpecies,
  type RoomLoaderUniversalOffer,
} from './roomLoaderConfigTypes';
import {
  asSpeciesSelection,
  speciesMatches,
  speciesSelectionIsAll,
} from './roomLoaderSpecies';

export { speciesMatches } from './roomLoaderSpecies';

/** One past service for the patient, used to answer "has this been done lately?". */
export type EngineHistoryEntry = {
  itemType?: RoomLoaderItemType | null;
  itemId?: number | null;
  code?: string | null;
  /** ISO date the service was rendered. */
  date?: string | null;
  /** Declined lines count for re-offer timing but never as "already done". */
  declined?: boolean;
};

/** An outstanding reminder, used to skip asks the patient does not need yet. */
export type EngineReminderEntry = {
  itemType?: RoomLoaderItemType | null;
  itemId?: number | null;
  code?: string | null;
  /** ISO due date. */
  dueDate?: string | null;
};

/** A line staff already put on the estimate. */
export type EngineEstimateLine = {
  itemType?: RoomLoaderItemType | null;
  itemId?: number | null;
  code?: string | null;
};

/** Everything the engine needs to know about one pet on the form. */
export type EngineContext = {
  species: RoomLoaderSpecies;
  /** Null when the patient has no birthdate; age-bounded rules then do not apply. */
  ageMonths: number | null;
  history: EngineHistoryEntry[];
  reminders: EngineReminderEntry[];
  estimateLines: EngineEstimateLine[];
  /** The owner's answer to the outdoor-access question, before they answer it: null. */
  outdoorAccess: boolean | null;
  /** Staff flagged a medical concern on this visit. */
  medicalConcern: boolean;
  /** Overrides "now" in tests. */
  asOf?: DateTime;
};

function now(ctx: Pick<EngineContext, 'asOf'>): DateTime {
  return ctx.asOf ?? DateTime.now();
}

function normCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

/** Age in whole months, or null when we have no usable birthdate. */
export function patientAgeMonths(
  birthdate: string | null | undefined,
  asOf: DateTime = DateTime.now()
): number | null {
  if (!birthdate) return null;
  const dob = DateTime.fromISO(String(birthdate));
  if (!dob.isValid || dob > asOf) return null;
  return Math.floor(asOf.diff(dob, 'months').months);
}

/** `minMonths` inclusive, `maxMonths` exclusive; a null max is open-ended. */
export function ageWindowMatches(window: RoomLoaderAgeWindow, ageMonths: number | null): boolean {
  const unbounded = (window.minMonths ?? 0) <= 0 && window.maxMonths == null;
  if (ageMonths == null) return unbounded;
  if (ageMonths < (window.minMonths ?? 0)) return false;
  if (window.maxMonths != null && ageMonths >= window.maxMonths) return false;
  return true;
}

function refMatches(
  ref: RoomLoaderItemRef,
  row: { itemType?: RoomLoaderItemType | null; itemId?: number | null; code?: string | null }
): boolean {
  if (row.itemId != null && row.itemType === ref.itemType && Number(row.itemId) === ref.itemId) {
    return true;
  }
  const refCode = normCode(ref.code);
  return refCode !== '' && normCode(row.code) === refCode;
}

/** True when a non-declined service for `ref` landed within `months` of now. */
export function hadItemWithinMonths(
  ref: RoomLoaderItemRef,
  history: EngineHistoryEntry[],
  months: number,
  asOf: DateTime = DateTime.now()
): boolean {
  const cutoff = asOf.minus({ months });
  return (history ?? []).some((row) => {
    if (row.declined) return false;
    if (!refMatches(ref, row)) return false;
    if (!row.date) return false;
    const when = DateTime.fromISO(String(row.date));
    return when.isValid && when >= cutoff;
  });
}

/** Most recent decline of `ref`, or null when the client never declined it. */
export function lastDeclineOf(
  ref: RoomLoaderItemRef,
  history: EngineHistoryEntry[]
): DateTime | null {
  let latest: DateTime | null = null;
  for (const row of history ?? []) {
    if (!row.declined || !refMatches(ref, row) || !row.date) continue;
    const when = DateTime.fromISO(String(row.date));
    if (!when.isValid) continue;
    if (!latest || when > latest) latest = when;
  }
  return latest;
}

/** True when a reminder for `ref` is due further out than `months` from now. */
export function hasReminderDueBeyondMonths(
  ref: RoomLoaderItemRef,
  reminders: EngineReminderEntry[],
  months: number,
  asOf: DateTime = DateTime.now()
): boolean {
  const threshold = asOf.plus({ months });
  return (reminders ?? []).some((row) => {
    if (!refMatches(ref, row)) return false;
    if (!row.dueDate) return false;
    const due = DateTime.fromISO(String(row.dueDate));
    return due.isValid && due >= threshold;
  });
}

/**
 * Applies the recency, reminder and prior-decline gates shared by every offer.
 * Returns true when the item should still be put in front of the client.
 */
export function historyGateAllows(
  gate: RoomLoaderHistoryGate,
  ref: RoomLoaderItemRef,
  ctx: EngineContext
): boolean {
  const asOf = now(ctx);

  if (
    gate.suppressIfDoneWithinMonths != null &&
    hadItemWithinMonths(ref, ctx.history, gate.suppressIfDoneWithinMonths, asOf)
  ) {
    return false;
  }

  if (
    gate.suppressIfReminderDueBeyondMonths != null &&
    hasReminderDueBeyondMonths(ref, ctx.reminders, gate.suppressIfReminderDueBeyondMonths, asOf)
  ) {
    return false;
  }

  const declinedAt = lastDeclineOf(ref, ctx.history);
  if (declinedAt) {
    if (!gate.showEvenIfPreviouslyDeclined) return false;
    if (gate.reofferDeclinedAfterMonths != null) {
      const reofferOn = declinedAt.plus({ months: gate.reofferDeclinedAfterMonths });
      if (asOf < reofferOn) return false;
    }
  }

  return true;
}

/** True when staff already put this item on the estimate. */
export function estimateHasItem(ref: RoomLoaderItemRef, lines: EngineEstimateLine[]): boolean {
  return (lines ?? []).some((line) => refMatches(ref, line));
}

function outdoorGateAllows(requiresOutdoor: boolean, ctx: EngineContext): boolean {
  if (!requiresOutdoor) return true;
  return ctx.outdoorAccess === true;
}

function enabledSpeciesRules(
  config: Pick<RoomLoaderConfig, 'panelRules'>,
  species: RoomLoaderSpecies
): RoomLoaderPanelRule[] {
  return (config.panelRules ?? [])
    .filter((rule) => rule.enabled)
    .filter((rule) => speciesMatches(rule.species, species))
    .filter((rule) => (rule.options ?? []).length > 0);
}

/**
 * When staff flagged that this visit warrants lab work, skip the age-based fecal /
 * early-detection rules and offer the species' choose-one (two-panel) screen instead.
 */
export function medicalConcernPanelRules(
  config: Pick<RoomLoaderConfig, 'panelRules'>,
  ctx: EngineContext
): RoomLoaderPanelRule[] {
  const twoPanel = enabledSpeciesRules(config, ctx.species)
    .filter((rule) => (rule.options ?? []).length > 1)
    .slice()
    .sort((a, b) => {
      const speciesRank = (rule: RoomLoaderPanelRule) => {
        const sel = asSpeciesSelection(rule.species);
        if (sel.includes(ctx.species)) return 2;
        if (speciesSelectionIsAll(sel)) return 1;
        return 0;
      };
      const bySpecies = speciesRank(b) - speciesRank(a);
      if (bySpecies !== 0) return bySpecies;
      const byOptions = (b.options?.length ?? 0) - (a.options?.length ?? 0);
      if (byOptions !== 0) return byOptions;
      const byMinAge = (b.age?.minMonths ?? 0) - (a.age?.minMonths ?? 0);
      if (byMinAge !== 0) return byMinAge;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
  return twoPanel.length > 0 ? [twoPanel[0]] : [];
}

/** Panel rules that apply to this pet, in ask order. */
export function selectPanelRules(
  config: Pick<RoomLoaderConfig, 'panelRules' | 'medicalConcern'>,
  ctx: EngineContext
): RoomLoaderPanelRule[] {
  if (ctx.medicalConcern && config.medicalConcern?.overwriteAgeBasedPanels !== false) {
    const concern = medicalConcernPanelRules(config, ctx);
    if (concern.length > 0) return concern;
  }
  return enabledSpeciesRules(config, ctx.species)
    .filter((rule) => ageWindowMatches(rule.age, ctx.ageMonths))
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/**
 * The individual tests to offer after the client crosses a panel out, minus any the
 * patient does not need yet.
 */
export function panelSubAsksFor(
  option: RoomLoaderPanelOption,
  ctx: EngineContext
): RoomLoaderPanelSubAsk[] {
  return (option.subAsks ?? [])
    .filter((sub) => outdoorGateAllows(sub.requiresOutdoorAccess, ctx))
    .filter((sub) => historyGateAllows(sub.history, sub.item, ctx));
}

/**
 * Estimate lines to strike when the client accepts a panel, because the panel already
 * covers them. Returns the matching lines so the caller can show them struck through.
 */
export function estimateLinesReplacedByPanel(
  option: RoomLoaderPanelOption,
  lines: EngineEstimateLine[]
): EngineEstimateLine[] {
  const refs = option.replacesItems ?? [];
  if (refs.length === 0) return [];
  return (lines ?? []).filter((line) => refs.some((ref) => refMatches(ref, line)));
}

/** Resolves the species-appropriate catalog item for a universal offer. */
export function universalOfferItem(
  offer: RoomLoaderUniversalOffer,
  species: RoomLoaderSpecies
): RoomLoaderItemRef | null {
  if (species === 'dog' && offer.itemBySpecies?.dog) return offer.itemBySpecies.dog;
  if (species === 'cat' && offer.itemBySpecies?.cat) return offer.itemBySpecies.cat;
  return offer.item ?? null;
}

export type ResolvedOffer = {
  id: string;
  displayName: string;
  descriptionHtml: string;
  cautionHtml: string;
  item: RoomLoaderItemRef;
};

/** Add-ons shown to everyone, skipping anything staff already estimated. */
export function universalOffersFor(
  config: RoomLoaderConfig,
  ctx: EngineContext
): ResolvedOffer[] {
  return (config.universalOffers ?? [])
    .filter((offer) => offer.enabled)
    .filter((offer) => speciesMatches(offer.species, ctx.species))
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .flatMap((offer) => {
      const item = universalOfferItem(offer, ctx.species);
      if (!item) return [];
      if (estimateHasItem(item, ctx.estimateLines)) return [];
      return [
        {
          id: offer.id,
          displayName: offer.displayName || item.name,
          descriptionHtml: offer.descriptionHtml ?? '',
          cautionHtml: '',
          item,
        },
      ];
    });
}

/**
 * The offered item plus any product variants that mean the same thing — the annual form
 * of a vaccine sold as an initial series, a combo product, a clinic SKU.
 */
export function gatedOfferRefs(offer: RoomLoaderGatedOffer): RoomLoaderItemRef[] {
  return offer.item ? [offer.item, ...(offer.equivalentItems ?? [])] : [];
}

/** Species/age/history-gated items such as vaccines due soon. */
export function gatedOffersFor(config: RoomLoaderConfig, ctx: EngineContext): ResolvedOffer[] {
  return (config.gatedOffers ?? [])
    .filter((offer) => offer.enabled)
    .filter((offer) => speciesMatches(offer.species, ctx.species))
    .filter((offer) => ageWindowMatches(offer.age, ctx.ageMonths))
    .filter((offer) => outdoorGateAllows(offer.requiresOutdoorAccess, ctx))
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .flatMap((offer) => {
      const item = offer.item;
      if (!item) return [];
      const refs = gatedOfferRefs(offer);
      if (refs.some((ref) => estimateHasItem(ref, ctx.estimateLines))) return [];
      if (!refs.every((ref) => historyGateAllows(offer.history, ref, ctx))) return [];
      return [
        {
          id: offer.id,
          displayName: offer.displayName || item.name,
          descriptionHtml: offer.descriptionHtml ?? '',
          cautionHtml: cautionHtmlFor(config, offer),
          item,
        },
      ];
    });
}

/** What "had this before" means for a question: its own history items, else its triggers. */
export function itemQuestionHistoryRefs(question: RoomLoaderItemQuestion): RoomLoaderItemRef[] {
  const own = question.historyItems ?? [];
  return own.length > 0 ? own : (question.triggerItems ?? []);
}

/**
 * Questions asked because of a line staff already put on the estimate — which form of a
 * vaccine the owner wants, whether to book the booster after a first dose.
 */
export function itemQuestionsFor(
  config: RoomLoaderConfig,
  ctx: EngineContext
): RoomLoaderItemQuestion[] {
  return (config.itemQuestions ?? [])
    .filter((question) => question.enabled)
    .filter((question) => speciesMatches(question.species, ctx.species))
    .filter((question) => ageWindowMatches(question.age, ctx.ageMonths))
    .filter((question) => (question.choices ?? []).length > 0)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .filter((question) => {
      const triggers = question.triggerItems ?? [];
      if (!triggers.some((ref) => estimateHasItem(ref, ctx.estimateLines))) return false;
      const historyRefs = itemQuestionHistoryRefs(question);
      if (question.askOnlyIfNeverHad && historyRefs.some((ref) => everHadItem(ref, ctx.history))) {
        return false;
      }
      return historyRefs.every((ref) => historyGateAllows(question.history, ref, ctx));
    });
}

/** True when the patient has a non-declined service for `ref` at any point on record. */
export function everHadItem(ref: RoomLoaderItemRef, history: EngineHistoryEntry[]): boolean {
  return (history ?? []).some((row) => !row.declined && refMatches(ref, row));
}

/** The item pitched off a yes to the outdoor-access question, when it still applies. */
export function outdoorPitchFor(
  config: RoomLoaderConfig,
  ctx: EngineContext
): ResolvedOffer | null {
  const outdoor = config.outdoor;
  if (!outdoor?.enabled) return null;
  if (!speciesMatches(outdoor.species, ctx.species)) return null;
  if (ctx.outdoorAccess !== true) return null;
  const item = outdoor.pitchItem;
  if (!item) return null;
  if (estimateHasItem(item, ctx.estimateLines)) return null;
  if (!historyGateAllows(outdoor.history, item, ctx)) return null;
  return {
    id: `outdoor_${item.itemType}_${item.itemId}`,
    displayName: outdoor.pitchDisplayName || item.name,
    descriptionHtml: outdoor.pitchHtml ?? '',
    cautionHtml: outdoor.pitchCautionHtml || (config.defaultDeclineCautionHtml ?? ''),
    item,
  };
}

/** True when this pet should see the outdoor-access question at all. */
export function shouldAskOutdoorAccess(config: RoomLoaderConfig, ctx: EngineContext): boolean {
  const outdoor = config.outdoor;
  if (!outdoor?.enabled) return false;
  return speciesMatches(outdoor.species, ctx.species);
}

/** Panels to offer when staff flagged a medical concern on the visit. */
export function medicalConcernOptionsFor(
  config: RoomLoaderConfig,
  ctx: EngineContext
): RoomLoaderPanelOption[] {
  const mc = config.medicalConcern;
  if (!mc?.enabled || !ctx.medicalConcern) return [];
  if (!speciesMatches(mc.species, ctx.species)) return [];
  return mc.options ?? [];
}

/**
 * The sample-collection cards to show for everything this client has accepted. A panel
 * only earns a card when the practice listed it on one, so a screen that bundles a fecal
 * explains the stool sample while a chemistry-only screen stays quiet.
 */
export function sampleInstructionsFor(
  config: Pick<RoomLoaderConfig, 'sampleInstructions'>,
  ctx: Pick<EngineContext, 'species'>,
  acceptedItems: EngineEstimateLine[]
): RoomLoaderSampleInstruction[] {
  if (acceptedItems.length === 0) return [];
  return (config.sampleInstructions ?? [])
    .filter((row) => row.enabled)
    .filter((row) => speciesMatches(row.species, ctx.species))
    .filter((row) =>
      (row.triggerItems ?? []).some((ref) => acceptedItems.some((line) => refMatches(ref, line)))
    )
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/** The crossed-out warning for an offer, falling back to the practice default. */
export function cautionHtmlFor(
  config: RoomLoaderConfig,
  offer: Pick<RoomLoaderGatedOffer, 'cautionHtml'> | null | undefined
): string {
  const own = (offer?.cautionHtml ?? '').trim();
  return own || (config.defaultDeclineCautionHtml ?? '');
}

export { fillPetName, migrateLegacyOutdoorPitchHtml } from './roomLoaderPetNameCopy';

/**
 * Everything the client form needs for one pet, resolved in one pass so the page
 * components stay declarative.
 */
export type ResolvedPetPlan = {
  panelRules: RoomLoaderPanelRule[];
  universalOffers: ResolvedOffer[];
  gatedOffers: ResolvedOffer[];
  outdoorPitch: ResolvedOffer | null;
  askOutdoorAccess: boolean;
  medicalConcernOptions: RoomLoaderPanelOption[];
  itemQuestions: RoomLoaderItemQuestion[];
};

export function resolvePetPlan(config: RoomLoaderConfig, ctx: EngineContext): ResolvedPetPlan {
  return {
    panelRules: selectPanelRules(config, ctx),
    universalOffers: universalOffersFor(config, ctx),
    gatedOffers: gatedOffersFor(config, ctx),
    outdoorPitch: outdoorPitchFor(config, ctx),
    askOutdoorAccess: shouldAskOutdoorAccess(config, ctx),
    medicalConcernOptions: medicalConcernOptionsFor(config, ctx),
    itemQuestions: itemQuestionsFor(config, ctx),
  };
}

/** Dedupe key so a pet never sees the same catalog item from two rules. */
export function offerKey(offer: ResolvedOffer): string {
  return roomLoaderItemKey(offer.item);
}

/** Drops repeats when universal, gated and outdoor offers resolve to the same item. */
export function dedupeOffers(...groups: ResolvedOffer[][]): ResolvedOffer[] {
  const seen = new Set<string>();
  const out: ResolvedOffer[] = [];
  for (const group of groups) {
    for (const offer of group) {
      const key = offerKey(offer);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(offer);
    }
  }
  return out;
}
