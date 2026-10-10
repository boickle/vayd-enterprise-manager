// src/utils/roomLoaderConfigTypes.ts
// Shape of the practice-scoped Room Loader configuration, kept free of the API client so
// the rules engine can be exercised outside a browser. `src/api/roomLoaderConfig.ts`
// re-exports all of this alongside the load/save calls.
import {
  asSpeciesSelection,
  type RoomLoaderSpeciesSelection,
} from './roomLoaderSpecies';
import { migrateLegacyOutdoorPitchHtml } from './roomLoaderPetNameCopy';

export type { RoomLoaderSpeciesSelection } from './roomLoaderSpecies';

export const ROOM_LOADER_CONFIG_VERSION = 1;

export type RoomLoaderItemType = 'lab' | 'procedure' | 'inventory';

/** Patient species slug (`dog`, `cat`, `rabbit`, …) or `any` for every species. */
export type RoomLoaderSpecies = string;

/**
 * Catalog item recorded on a rule. `itemType` + `itemId` is the join key the backend
 * prices and reconciles with; `name`/`code` are denormalised so the settings UI and the
 * client form can render without a second lookup.
 */
export type RoomLoaderItemRef = {
  itemType: RoomLoaderItemType;
  itemId: number;
  name: string;
  code: string | null;
};

/**
 * Half-open age window in months: `minMonths` inclusive, `maxMonths` exclusive.
 * `maxMonths: null` means no upper bound.
 */
export type RoomLoaderAgeWindow = {
  minMonths: number;
  maxMonths: number | null;
};

/** Shared gating for "has the patient already had this recently?" questions. */
export type RoomLoaderHistoryGate = {
  /** Skip the ask when a non-declined dose/test exists inside this window. Null disables. */
  suppressIfDoneWithinMonths: number | null;
  /** Skip the ask when a matching reminder is due further out than this. Null disables. */
  suppressIfReminderDueBeyondMonths: number | null;
  /**
   * Offer anyway when the client declined it before. When false the item stays hidden
   * after a decline until `suppressIfDoneWithinMonths` would have lapsed anyway.
   */
  showEvenIfPreviouslyDeclined: boolean;
  /** With `showEvenIfPreviouslyDeclined`, wait this long after the decline before re-asking. */
  reofferDeclinedAfterMonths: number | null;
};

export function emptyHistoryGate(): RoomLoaderHistoryGate {
  return {
    suppressIfDoneWithinMonths: null,
    suppressIfReminderDueBeyondMonths: null,
    showEvenIfPreviouslyDeclined: false,
    reofferDeclinedAfterMonths: null,
  };
}

/**
 * A follow-up ask shown when the client crosses out a lab panel — e.g. offering the
 * heartworm test and fecal separately after an early-detection panel is declined.
 */
export type RoomLoaderPanelSubAsk = {
  id: string;
  item: RoomLoaderItemRef;
  /** Client-facing label; falls back to the catalog name when blank. */
  displayName: string;
  /** "Why we recommend this" copy shown beside the sub-ask. HTML. */
  cautionHtml: string;
  /** Only ask for cats whose owner answered yes to the outdoor-access question. */
  requiresOutdoorAccess: boolean;
  history: RoomLoaderHistoryGate;
};

/**
 * One panel the client can accept. A rule with several options becomes a choose-one
 * question (e.g. senior chemistry screen OR the extended panel).
 */
export type RoomLoaderPanelOption = {
  id: string;
  item: RoomLoaderItemRef;
  displayName: string;
  /** Rich description shown to the client for this panel. HTML. */
  descriptionHtml: string;
  /** Sample-results image shown under the description. Data URL or path. */
  imageUrl: string | null;
  /** Caption rendered under `imageUrl`. */
  imageCaption: string;
  /** Items pulled off the staff estimate when the client accepts this panel. */
  replacesItems: RoomLoaderItemRef[];
  /** Offered individually when the client crosses this panel out. */
  subAsks: RoomLoaderPanelSubAsk[];
};

/** "Ask about this panel for this species at this age." */
export type RoomLoaderPanelRule = {
  id: string;
  /** Internal name for the settings list, e.g. "Puppy/kitten fecal". */
  label: string;
  enabled: boolean;
  species: RoomLoaderSpeciesSelection;
  age: RoomLoaderAgeWindow;
  /**
   * Shown above the options on a routine visit. HTML.
   * `{petName}`, `{doctorName}`, `{panel1}`, `{panel2}` are filled in on the form.
   * Prices stay on the choices themselves, not in this copy.
   */
  introHtml: string;
  /** Same slot when staff flagged a medical concern. Falls back to `introHtml`. */
  concernIntroHtml: string;
  /** Shown under the choices on a routine visit. HTML. Same placeholders. */
  closingHtml: string;
  /** Shown under the choices when a medical concern was flagged. */
  concernClosingHtml: string;
  /**
   * Membership this panel is meant to line up with. Its youngest and oldest age
   * (Settings → Memberships) are the ages Room Loader checks against.
   */
  alignPackageId: number | null;
  options: RoomLoaderPanelOption[];
  /** Lower numbers ask first when several rules match one pet. */
  sortOrder: number;
};

/** An add-on offered to every patient regardless of age or history. */
export type RoomLoaderUniversalOffer = {
  id: string;
  enabled: boolean;
  displayName: string;
  species: RoomLoaderSpeciesSelection;
  descriptionHtml: string;
  /** Used when the practice sells one item for both species. */
  item: RoomLoaderItemRef | null;
  /** Species-specific variants, e.g. a dog pedicure and a cat pedicure. */
  itemBySpecies: { dog: RoomLoaderItemRef | null; cat: RoomLoaderItemRef | null };
  sortOrder: number;
};

/** An item offered only to some species, at some ages, when history allows. */
export type RoomLoaderGatedOffer = {
  id: string;
  enabled: boolean;
  displayName: string;
  species: RoomLoaderSpeciesSelection;
  item: RoomLoaderItemRef | null;
  /**
   * Other catalog rows that mean the pet is already covered — product variants such as
   * the annual form of a vaccine sold as an initial series, combo products, or clinic
   * SKUs. They count for "already on the estimate" and for every history gate below,
   * so one offer does not fire because staff used a different product code.
   */
  equivalentItems: RoomLoaderItemRef[];
  age: RoomLoaderAgeWindow;
  history: RoomLoaderHistoryGate;
  /** Only offer when the owner answered yes to the outdoor-access question. */
  requiresOutdoorAccess: boolean;
  descriptionHtml: string;
  /** Shown when the client crosses the item out. HTML. */
  cautionHtml: string;
  sortOrder: number;
};

/**
 * "Why we recommend this" copy for an estimate line the client unchecks. Keyed by
 * catalog item so a practice can explain its own vaccines and screenings without a
 * code change.
 */
export type RoomLoaderDeclineReason = {
  id: string;
  /** Internal name for the settings list, e.g. "Rabies". */
  label: string;
  /** Every catalog row this copy covers (1-year, 3-year, boosters, clinic SKUs). */
  items: RoomLoaderItemRef[];
  /** Shown under the row once it is unchecked. HTML. */
  html: string;
};

/** The outdoor-access question and whatever the practice pitches off a yes. */
export type RoomLoaderOutdoorConfig = {
  enabled: boolean;
  species: RoomLoaderSpeciesSelection;
  /** `{petName}` is substituted with the patient's name. */
  questionText: string;
  required: boolean;
  /** Shown after a yes, above the pitched item. HTML. */
  pitchHtml: string;
  /** Offered when the owner answers yes. */
  pitchItem: RoomLoaderItemRef | null;
  pitchDisplayName: string;
  pitchCautionHtml: string;
  /** Skip the pitch when the patient already had it inside this window. */
  history: RoomLoaderHistoryGate;
};

/** Panels to ask about when staff flagged a medical concern on the visit. */
export type RoomLoaderMedicalConcernConfig = {
  enabled: boolean;
  /**
   * When true, a medical-concern visit uses this species’ two-panel rule at any
   * age instead of the fecal or early-detection ask.
   */
  overwriteAgeBasedPanels: boolean;
  /** Shown above the panel options. HTML. */
  introHtml: string;
  /** Options keyed by species; `any` entries apply to every pet. */
  options: RoomLoaderPanelOption[];
  species: RoomLoaderSpeciesSelection;
};

/** Copy and placement for the membership pitch on the summary page. */
export type RoomLoaderMembershipConfig = {
  enabled: boolean;
  /** `top` puts the pitch above the estimate; `before-total` keeps it above the total. */
  placement: 'top' | 'before-total';
  /** Render the comparison open instead of behind a disclosure. */
  startExpanded: boolean;
  /** Rows of savings to show before the client expands. 0 shows the headline only. */
  previewRowCount: number;
  headline: string;
  subheadHtml: string;
  expandLabel: string;
  collapseLabel: string;
};

/** The chronic-medication refill question that replaces the pre-exam meds ask. */
export type RoomLoaderChronicMedsConfig = {
  enabled: boolean;
  /** `{petName}` is substituted with the patient's name. */
  questionText: string;
  introHtml: string;
  /** Offer "bring it to the visit" as a fulfilment choice. */
  allowBring: boolean;
  bringLabel: string;
  /** Offer "ship it to me" as a fulfilment choice. */
  allowShip: boolean;
  shipLabel: string;
  /** Let the client type a medication we have no prescription record for. */
  allowFreeText: boolean;
  freeTextLabel: string;
};

/** One row of a prevention / product guide table. */
export type RoomLoaderProductGuideRow = {
  id: string;
  /** Left-hand label, e.g. "One and Done". */
  approach: string;
  medication: string;
  schedule: string;
  /** What it protects against. HTML, so a practice can bullet several lines. */
  coversHtml: string;
};

/** A comparison table shown to owners of one species. */
export type RoomLoaderProductGuideTable = {
  id: string;
  species: RoomLoaderSpeciesSelection;
  heading: string;
  /** Shown above the table, e.g. a note about switching products. HTML. */
  noteHtml: string;
  rows: RoomLoaderProductGuideRow[];
  /** Shown below the table. HTML. */
  footerHtml: string;
  sortOrder: number;
};

/**
 * The collapsible "what prevention do you carry?" guide on the summary page. Purely
 * informational: it explains the products a practice stocks so the owner can search for
 * one in the store search above it.
 */
export type RoomLoaderProductGuideConfig = {
  enabled: boolean;
  /** Text on the disclosure the owner clicks to open the guide. */
  summaryLabel: string;
  tables: RoomLoaderProductGuideTable[];
};

/** One answer to a follow-up question. The label is what staff reads back on the PDF. */
export type RoomLoaderQuestionChoice = {
  id: string;
  label: string;
};

/**
 * A question asked because of something already on the estimate, rather than to add a
 * new item: which form of a vaccine the owner prefers, whether to book the booster that
 * follows a first dose. The answer is recorded for staff; it does not change the estimate.
 */
export type RoomLoaderItemQuestion = {
  id: string;
  enabled: boolean;
  /** Internal name, shown only in Settings. */
  label: string;
  species: RoomLoaderSpeciesSelection;
  age: RoomLoaderAgeWindow;
  /** Asked only when staff put one of these on this visit's estimate. */
  triggerItems: RoomLoaderItemRef[];
  /**
   * What counts as "had this before" for `askOnlyIfNeverHad` and for the history gate.
   * Falls back to the trigger items, so a question about one product can still look at
   * every form of it.
   */
  historyItems: RoomLoaderItemRef[];
  /** Skip the question once the pet has had any history item — for first-dose-only asks. */
  askOnlyIfNeverHad: boolean;
  history: RoomLoaderHistoryGate;
  /** `{petName}` is substituted with the patient's name. */
  questionText: string;
  /** Shown under the question. HTML. */
  helpHtml: string;
  required: boolean;
  choices: RoomLoaderQuestionChoice[];
  sortOrder: number;
};

/**
 * "Here is how to collect it" copy shown on the labs page once the client has accepted
 * something the owner has to bring a sample in for. Keyed by catalog item so a panel
 * that bundles a fecal shows the fecal card and a panel that does not shows nothing.
 */
export type RoomLoaderSampleInstruction = {
  id: string;
  enabled: boolean;
  /** Internal name for the settings list, e.g. "Stool sample — dogs". */
  label: string;
  species: RoomLoaderSpeciesSelection;
  /** Accepting any of these — a panel, a sub-ask, or a line already on the estimate — shows the card. */
  triggerItems: RoomLoaderItemRef[];
  /** Heading on the card. `{petName}` is substituted. */
  heading: string;
  /** Body of the card. HTML. `{petName}` is substituted. */
  bodyHtml: string;
  sortOrder: number;
};

/** Global copy for the labs page. */
export type RoomLoaderLabsPageConfig = {
  title: string;
  /** Shown at the top of the labs page. HTML. */
  introHtml: string;
  /** Shown when staff flagged a medical concern. HTML. */
  medicalConcernIntroHtml: string;
  /** Sample-results image shown once at the top of the labs page. */
  imageUrl: string | null;
  imageCaption: string;
};

export type RoomLoaderConfig = {
  version: number;
  panelRules: RoomLoaderPanelRule[];
  universalOffers: RoomLoaderUniversalOffer[];
  gatedOffers: RoomLoaderGatedOffer[];
  /** Questions triggered by an estimate line, such as a vaccine product preference. */
  itemQuestions: RoomLoaderItemQuestion[];
  outdoor: RoomLoaderOutdoorConfig;
  medicalConcern: RoomLoaderMedicalConcernConfig;
  membership: RoomLoaderMembershipConfig;
  chronicMeds: RoomLoaderChronicMedsConfig;
  labsPage: RoomLoaderLabsPageConfig;
  /** How to collect a stool or urine sample, shown once the client accepts a test that needs one. */
  sampleInstructions: RoomLoaderSampleInstruction[];
  productGuide: RoomLoaderProductGuideConfig;
  /** "Why we recommend this" copy for estimate lines the client unchecks. */
  declineReasons: RoomLoaderDeclineReason[];
  /** Fallback caution when an offer has no `cautionHtml` of its own. HTML. */
  defaultDeclineCautionHtml: string;
};

export function emptyRoomLoaderConfig(): RoomLoaderConfig {
  return {
    version: ROOM_LOADER_CONFIG_VERSION,
    panelRules: [],
    universalOffers: [],
    gatedOffers: [],
    itemQuestions: [],
    outdoor: {
      enabled: false,
      species: ['cat'],
      questionText: 'Does {petName} go outdoors or live with a cat who does?',
      required: true,
      pitchHtml: '',
      pitchItem: null,
      pitchDisplayName: '',
      pitchCautionHtml: '',
      history: emptyHistoryGate(),
    },
    medicalConcern: {
      enabled: false,
      overwriteAgeBasedPanels: true,
      introHtml: '',
      options: [],
      species: ['any'],
    },
    membership: {
      enabled: true,
      placement: 'top',
      startExpanded: false,
      previewRowCount: 3,
      headline: 'See how a membership could change your bill',
      subheadHtml: '',
      expandLabel: 'See the full comparison',
      collapseLabel: 'Hide the comparison',
    },
    chronicMeds: {
      enabled: false,
      questionText: 'Does {petName} need a refill of any ongoing medication?',
      introHtml: '',
      allowBring: true,
      bringLabel: 'Bring it to the visit',
      allowShip: true,
      shipLabel: 'Ship it to me',
      allowFreeText: true,
      freeTextLabel: 'Something else we should bring',
    },
    labsPage: {
      title: 'Labs we recommend',
      introHtml: '',
      medicalConcernIntroHtml: '',
      imageUrl: null,
      imageCaption: '',
    },
    sampleInstructions: [],
    productGuide: {
      enabled: false,
      summaryLabel: 'Learn more about the prevention we offer',
      tables: [],
    },
    declineReasons: [],
    defaultDeclineCautionHtml: '',
  };
}

function withNormalizedSpecies<T extends { species?: unknown }>(row: T): T {
  return { ...row, species: asSpeciesSelection(row.species) };
}

/** Fills in anything a stored config predates, so older rows stay loadable. */
export function normalizeRoomLoaderConfig(raw: unknown): RoomLoaderConfig {
  const base = emptyRoomLoaderConfig();
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as Partial<RoomLoaderConfig>;
  const productGuideIn = {
    ...base.productGuide,
    ...(input.productGuide ?? {}),
  };
  return {
    version: ROOM_LOADER_CONFIG_VERSION,
    panelRules: Array.isArray(input.panelRules)
      ? input.panelRules.map(withNormalizedSpecies)
      : base.panelRules,
    universalOffers: Array.isArray(input.universalOffers)
      ? input.universalOffers.map(withNormalizedSpecies)
      : base.universalOffers,
    gatedOffers: Array.isArray(input.gatedOffers)
      ? input.gatedOffers.map((offer) => ({
          ...withNormalizedSpecies(offer),
          equivalentItems: Array.isArray(offer.equivalentItems) ? offer.equivalentItems : [],
        }))
      : base.gatedOffers,
    itemQuestions: Array.isArray(input.itemQuestions)
      ? input.itemQuestions.map((question) => ({
          ...withNormalizedSpecies(question),
          triggerItems: Array.isArray(question.triggerItems) ? question.triggerItems : [],
          historyItems: Array.isArray(question.historyItems) ? question.historyItems : [],
          choices: Array.isArray(question.choices) ? question.choices : [],
          history: { ...emptyHistoryGate(), ...(question.history ?? {}) },
        }))
      : base.itemQuestions,
    outdoor: (() => {
      const outdoorIn = { ...base.outdoor, ...(input.outdoor ?? {}) };
      const species = asSpeciesSelection(outdoorIn.species ?? base.outdoor.species);
      const pitchHtml =
        typeof outdoorIn.pitchHtml === 'string'
          ? migrateLegacyOutdoorPitchHtml(outdoorIn.pitchHtml)
          : base.outdoor.pitchHtml;
      const pitchCautionHtml =
        typeof outdoorIn.pitchCautionHtml === 'string'
          ? migrateLegacyOutdoorPitchHtml(outdoorIn.pitchCautionHtml)
          : base.outdoor.pitchCautionHtml;
      return { ...outdoorIn, species, pitchHtml, pitchCautionHtml };
    })(),
    medicalConcern: {
      ...base.medicalConcern,
      ...(input.medicalConcern ?? {}),
      species: asSpeciesSelection(input.medicalConcern?.species ?? base.medicalConcern.species),
    },
    membership: { ...base.membership, ...(input.membership ?? {}) },
    chronicMeds: { ...base.chronicMeds, ...(input.chronicMeds ?? {}) },
    labsPage: { ...base.labsPage, ...(input.labsPage ?? {}) },
    sampleInstructions: Array.isArray(input.sampleInstructions)
      ? input.sampleInstructions.map((row) => ({
          ...withNormalizedSpecies(row),
          triggerItems: Array.isArray(row.triggerItems) ? row.triggerItems : [],
        }))
      : base.sampleInstructions,
    productGuide: {
      ...productGuideIn,
      tables: Array.isArray(productGuideIn.tables)
        ? productGuideIn.tables.map(withNormalizedSpecies)
        : base.productGuide.tables,
    },
    declineReasons: Array.isArray(input.declineReasons)
      ? input.declineReasons.map((reason) => ({
          ...reason,
          items: Array.isArray(reason.items) ? reason.items : [],
        }))
      : base.declineReasons,
    defaultDeclineCautionHtml:
      typeof input.defaultDeclineCautionHtml === 'string'
        ? input.defaultDeclineCautionHtml
        : base.defaultDeclineCautionHtml,
  };
}

/** Stable key for matching a rule item against an estimate line or history row. */
export function roomLoaderItemKey(ref: Pick<RoomLoaderItemRef, 'itemType' | 'itemId'>): string {
  return `${ref.itemType}:${ref.itemId}`;
}

export function newRoomLoaderId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
