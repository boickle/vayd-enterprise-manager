// src/pages/roomLoader/roomLoaderConfigPlan.ts
// Reads the client's answers back out of the configured Room Loader sections so the
// estimate, the submit payload and the validators all agree on what was accepted.
import {
  dedupeOffers,
  estimateLinesReplacedByPanel,
  fillPetName,
  panelSubAsksFor,
  sampleInstructionsFor,
  type EngineContext,
  type EngineEstimateLine,
  type ResolvedOffer,
  type ResolvedPetPlan,
} from '../../utils/roomLoaderOfferEngine';
import {
  roomLoaderItemKey,
  type RoomLoaderConfig,
  type RoomLoaderItemRef,
  type RoomLoaderPanelOption,
  type RoomLoaderPanelSubAsk,
  type RoomLoaderSampleInstruction,
} from '../../utils/roomLoaderConfigTypes';
import {
  PANEL_ACCEPTED,
  PANEL_DECLINED,
  chosenPanelOptionId,
  chronicMedKey,
  chronicMedsOtherKey,
  itemQuestionKey,
  medicalConcernPanelKey,
  offerKey,
  outdoorAccessKey,
  outdoorPitchKey,
  panelAnswerKey,
  panelIsDeclined,
  panelSubAskKey,
} from './roomLoaderFormKeys';
import type { ChronicMed } from './ChronicMedsSection';

type FormData = Record<string, any>;

function usableRef(ref: RoomLoaderItemRef | null | undefined): ref is RoomLoaderItemRef {
  return ref != null && Number.isFinite(Number(ref.itemId)) && Number(ref.itemId) > 0;
}

/** Every catalog item the configured sections can show, so pricing is fetched in one batch. */
export function configuredItemRefs(config: RoomLoaderConfig): RoomLoaderItemRef[] {
  const out: RoomLoaderItemRef[] = [];
  const push = (ref: RoomLoaderItemRef | null | undefined) => {
    if (usableRef(ref)) out.push(ref);
  };
  const pushOption = (option: RoomLoaderPanelOption) => {
    push(option.item);
    for (const sub of option.subAsks ?? []) push(sub.item);
  };
  for (const rule of config.panelRules ?? []) {
    for (const option of rule.options ?? []) pushOption(option);
  }
  for (const option of config.medicalConcern?.options ?? []) pushOption(option);
  for (const offer of config.universalOffers ?? []) {
    push(offer.item);
    push(offer.itemBySpecies?.dog);
    push(offer.itemBySpecies?.cat);
  }
  for (const offer of config.gatedOffers ?? []) push(offer.item);
  push(config.outdoor?.pitchItem);

  const seen = new Set<string>();
  return out.filter((ref) => {
    const key = roomLoaderItemKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The add-on groups, with one catalog item never asked twice; the outdoor pitch wins. */
export function splitDedupedOffers(plan: ResolvedPetPlan): {
  gated: ResolvedOffer[];
  universal: ResolvedOffer[];
} {
  const kept = new Set(
    dedupeOffers(
      plan.outdoorPitch ? [plan.outdoorPitch] : [],
      plan.gatedOffers,
      plan.universalOffers
    ).map((offer) => offer.id)
  );
  return {
    gated: plan.gatedOffers.filter((offer) => kept.has(offer.id)),
    universal: plan.universalOffers.filter((offer) => kept.has(offer.id)),
  };
}

/** Panels the client accepted, across the panel rules and the medical-concern options. */
export function acceptedPanelOptions(
  plan: ResolvedPetPlan,
  petKey: string,
  formData: FormData
): RoomLoaderPanelOption[] {
  const out: RoomLoaderPanelOption[] = [];
  for (const rule of plan.panelRules) {
    const options = rule.options ?? [];
    if (options.length === 0) continue;
    const chosenId = chosenPanelOptionId(formData[panelAnswerKey(petKey, rule.id)], options[0].id);
    const option = chosenId != null ? options.find((o) => o.id === chosenId) : undefined;
    if (option) out.push(option);
  }
  for (const option of plan.medicalConcernOptions) {
    if (String(formData[medicalConcernPanelKey(petKey, option.id)] ?? '') === PANEL_ACCEPTED) {
      out.push(option);
    }
  }
  return out;
}

/**
 * Individual tests the client accepted after crossing a panel out. Mirrors
 * `LabPanelsSection`: options of a declined rule are flattened and deduped by item.
 */
export function acceptedPanelSubAsks(
  plan: ResolvedPetPlan,
  ctx: EngineContext,
  petKey: string,
  formData: FormData
): RoomLoaderPanelSubAsk[] {
  const out: RoomLoaderPanelSubAsk[] = [];
  const seen = new Set<string>();
  for (const rule of plan.panelRules) {
    const options = rule.options ?? [];
    if (options.length === 0) continue;
    if (!panelIsDeclined(formData[panelAnswerKey(petKey, rule.id)])) continue;
    for (const option of options) {
      for (const sub of panelSubAsksFor(option, ctx)) {
        const key = roomLoaderItemKey(sub.item);
        if (seen.has(key)) continue;
        seen.add(key);
        if (String(formData[panelSubAskKey(petKey, sub.id)] ?? '') !== 'yes') continue;
        out.push(sub);
      }
    }
  }
  return out;
}

/** Sub-asks shown to this client, whatever their answer, so validation knows what to require. */
export function visiblePanelSubAsks(
  plan: ResolvedPetPlan,
  ctx: EngineContext,
  petKey: string,
  formData: FormData
): RoomLoaderPanelSubAsk[] {
  const out: RoomLoaderPanelSubAsk[] = [];
  const seen = new Set<string>();
  for (const rule of plan.panelRules) {
    const options = rule.options ?? [];
    if (options.length === 0) continue;
    if (!panelIsDeclined(formData[panelAnswerKey(petKey, rule.id)])) continue;
    for (const option of options) {
      for (const sub of panelSubAsksFor(option, ctx)) {
        const key = roomLoaderItemKey(sub.item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(sub);
      }
    }
  }
  return out;
}

/**
 * The sample-collection cards this pet has earned: from the panels and individual tests
 * accepted on the labs page, plus any lab staff already put on the estimate. Estimate
 * lines an accepted panel absorbs are left out, since the panel itself speaks for them.
 */
export function sampleInstructionsForAnswers(opts: {
  config: RoomLoaderConfig;
  plan: ResolvedPetPlan;
  ctx: EngineContext;
  petKey: string;
  formData: FormData;
}): RoomLoaderSampleInstruction[] {
  const { config, plan, ctx, petKey, formData } = opts;
  const options = acceptedPanelOptions(plan, petKey, formData);
  const absorbed = panelReplacementLabels(options, ctx.estimateLines);
  const accepted: EngineEstimateLine[] = [
    ...options.map((option) => option.item),
    ...acceptedPanelSubAsks(plan, ctx, petKey, formData).map((sub) => sub.item),
    ...(ctx.estimateLines ?? []).filter(
      (line) => !estimateLineKeys(line).some((key) => absorbed.has(key))
    ),
  ];
  return sampleInstructionsFor(config, ctx, accepted);
}

/** Add-ons the client said yes to. */
export function acceptedOffers(
  offers: ResolvedOffer[],
  petKey: string,
  formData: FormData
): ResolvedOffer[] {
  return offers.filter((offer) => String(formData[offerKey(petKey, offer.id)] ?? '') === 'yes');
}

/** The item pitched off an outdoor-access yes, when the client accepted it. */
export function acceptedOutdoorPitch(
  plan: ResolvedPetPlan,
  petKey: string,
  formData: FormData
): ResolvedOffer | null {
  if (!plan.outdoorPitch) return null;
  return String(formData[outdoorPitchKey(petKey)] ?? '') === 'yes' ? plan.outdoorPitch : null;
}

/** Every configured catalog item this client added to the visit, in estimate order. */
export function acceptedConfigItems(
  plan: ResolvedPetPlan,
  ctx: EngineContext,
  petKey: string,
  formData: FormData
): Array<{ displayName: string; item: RoomLoaderItemRef; category: 'lab' | 'vaccine' | 'common' }> {
  const out: Array<{
    displayName: string;
    item: RoomLoaderItemRef;
    category: 'lab' | 'vaccine' | 'common';
  }> = [];
  const seen = new Set<string>();
  const add = (
    displayName: string,
    item: RoomLoaderItemRef | null | undefined,
    category: 'lab' | 'vaccine' | 'common'
  ) => {
    if (!usableRef(item)) return;
    const key = roomLoaderItemKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ displayName: displayName || item.name, item, category });
  };

  for (const option of acceptedPanelOptions(plan, petKey, formData)) {
    add(option.displayName, option.item, 'lab');
  }
  for (const sub of acceptedPanelSubAsks(plan, ctx, petKey, formData)) {
    add(sub.displayName, sub.item, 'lab');
  }
  const { gated, universal } = splitDedupedOffers(plan);
  const pitch = acceptedOutdoorPitch(plan, petKey, formData);
  if (pitch) add(pitch.displayName, pitch.item, 'vaccine');
  for (const offer of acceptedOffers(gated, petKey, formData)) {
    add(offer.displayName, offer.item, 'vaccine');
  }
  for (const offer of acceptedOffers(universal, petKey, formData)) {
    add(offer.displayName, offer.item, 'common');
  }
  return out;
}

/** Summary-page opt-out for a configured item the client accepted earlier in the form. */
export function configSummaryExcludeKey(petKey: string, item: RoomLoaderItemRef): string {
  return `summary_exclude_${petKey}_${roomLoaderItemKey(item)}`;
}

/** Accepted panels the client has not since crossed off the estimate. */
export function effectiveAcceptedPanelOptions(
  plan: ResolvedPetPlan,
  petKey: string,
  formData: FormData
): RoomLoaderPanelOption[] {
  return acceptedPanelOptions(plan, petKey, formData).filter(
    (option) => formData[configSummaryExcludeKey(petKey, option.item)] !== true
  );
}

/**
 * Staff estimate lines an accepted panel already covers, keyed so a display row can be
 * matched back by catalog id or by code, mapped to the panel that replaced it.
 */
export function panelReplacementLabels(
  options: RoomLoaderPanelOption[],
  estimateLines: EngineEstimateLine[]
): Map<string, string> {
  const out = new Map<string, string>();
  for (const option of options) {
    const label = option.displayName || option.item.name;
    for (const line of estimateLinesReplacedByPanel(option, estimateLines)) {
      for (const key of estimateLineKeys(line)) {
        if (!out.has(key)) out.set(key, label);
      }
    }
  }
  return out;
}

function estimateLineKeys(line: {
  itemType?: string | null;
  itemId?: number | null;
  code?: string | null;
}): string[] {
  const keys: string[] = [];
  const itemType = String(line.itemType ?? '').toLowerCase();
  if (line.itemId != null && itemType !== '') keys.push(`${itemType}:${line.itemId}`);
  const code = String(line.code ?? '').trim().toUpperCase();
  if (code !== '') keys.push(`code:${code}`);
  return keys;
}

/** Name of the panel that covers this estimate row, or null when it still stands on its own. */
export function rowReplacedByPanel(
  row: { itemType?: string | null; type?: string | null; id?: number | null; code?: string | null },
  labels: Map<string, string>
): string | null {
  if (labels.size === 0) return null;
  for (const key of estimateLineKeys({
    itemType: row.itemType ?? row.type ?? null,
    itemId: row.id ?? null,
    code: row.code ?? null,
  })) {
    const label = labels.get(key);
    if (label) return label;
  }
  return null;
}

export type ConfigQuestionAnswer = {
  question: string;
  answer: string | null;
  answerLabel: string | null;
};

/**
 * The configured sections as readable question/answer pairs for `formAnswersForPdf`,
 * using the practice's own display names so the PDF reads like the form did.
 */
export function configAnswerQuestions(opts: {
  config: RoomLoaderConfig;
  plan: ResolvedPetPlan;
  ctx: EngineContext;
  petKey: string;
  petName: string;
  formData: FormData;
  chronicMeds: ChronicMed[];
}): { carePlan: ConfigQuestionAnswer[]; labs: ConfigQuestionAnswer[]; checkIn: ConfigQuestionAnswer[] } {
  const { config, plan, ctx, petKey, petName, formData, chronicMeds } = opts;
  const raw = (key: string) => {
    const value = formData[key];
    return value == null || value === '' ? null : String(value);
  };

  const labs: ConfigQuestionAnswer[] = [];
  for (const rule of plan.panelRules) {
    const options = rule.options ?? [];
    if (options.length === 0) continue;
    const answer = raw(panelAnswerKey(petKey, rule.id));
    const question =
      options.length > 1
        ? `Which lab work would you like for ${petName}? (${rule.label || options[0].displayName})`
        : `Would you like the ${options[0].displayName} for ${petName}?`;
    let label: string | null = null;
    if (answer === PANEL_DECLINED) label = 'No lab work today';
    else if (answer === PANEL_ACCEPTED) label = `Yes — ${options[0].displayName}`;
    else if (answer != null) label = options.find((o) => o.id === answer)?.displayName ?? answer;
    labs.push({ question, answer, answerLabel: label });
  }
  for (const sub of visiblePanelSubAsks(plan, ctx, petKey, formData)) {
    const answer = raw(panelSubAskKey(petKey, sub.id));
    labs.push({
      question: `Would you like ${sub.displayName || sub.item.name} on its own for ${petName}?`,
      answer,
      answerLabel: answer === 'yes' ? 'Yes' : answer === 'no' ? 'No' : null,
    });
  }
  for (const option of plan.medicalConcernOptions) {
    const answer = raw(medicalConcernPanelKey(petKey, option.id));
    labs.push({
      question: `Would you like the ${option.displayName} for ${petName}?`,
      answer,
      answerLabel: answer === PANEL_ACCEPTED ? 'Yes' : answer === PANEL_DECLINED ? 'No' : null,
    });
  }

  const carePlan: ConfigQuestionAnswer[] = [];
  if (plan.askOutdoorAccess) {
    const answer = raw(outdoorAccessKey(petKey));
    carePlan.push({
      question: fillPetName(config.outdoor.questionText, petName),
      answer,
      answerLabel: answer === 'yes' ? 'Yes' : answer === 'no' ? 'No' : null,
    });
  }
  if (plan.outdoorPitch) {
    const answer = raw(outdoorPitchKey(petKey));
    carePlan.push({
      question: `Would you like ${plan.outdoorPitch.displayName} for ${petName}?`,
      answer,
      answerLabel: answer === 'yes' ? 'Yes' : answer === 'no' ? 'No' : null,
    });
  }
  const { gated, universal } = splitDedupedOffers(plan);
  for (const offer of [...gated, ...universal]) {
    const answer = raw(offerKey(petKey, offer.id));
    carePlan.push({
      question: `Would you like ${offer.displayName} for ${petName}?`,
      answer,
      answerLabel: answer === 'yes' ? 'Yes' : answer === 'no' ? 'No' : null,
    });
  }
  for (const question of plan.itemQuestions) {
    const answer = raw(itemQuestionKey(petKey, question.id));
    carePlan.push({
      question: fillPetName(question.questionText, petName),
      answer,
      answerLabel: question.choices.find((c) => c.id === answer)?.label ?? null,
    });
  }

  if (config.chronicMeds.enabled) {
    const fulfilmentLabel = (answer: string | null): string | null => {
      if (answer === 'bring') return config.chronicMeds.bringLabel || 'Bring it to the visit';
      if (answer === 'ship') return config.chronicMeds.shipLabel || 'Ship it to me';
      if (answer === 'no') return 'No refill needed';
      return null;
    };
    for (const med of chronicMeds) {
      const answer = raw(chronicMedKey(petKey, med.prescriptionId));
      carePlan.push({
        question: `${fillPetName(config.chronicMeds.questionText, petName)} — ${med.name}${
          med.strength ? ` ${med.strength}` : ''
        }`,
        answer,
        answerLabel: fulfilmentLabel(answer),
      });
    }
    if (config.chronicMeds.allowFreeText && chronicMeds.length > 0) {
      const answer = raw(chronicMedsOtherKey(petKey));
      carePlan.push({
        question: config.chronicMeds.freeTextLabel || 'Anything else you need refilled?',
        answer,
        answerLabel: answer,
      });
    }
  }

  return { carePlan, labs, checkIn: [] };
}

/** Required configured answers that are still blank, keyed by form field. */
export function missingConfigAnswers(opts: {
  config: RoomLoaderConfig;
  plan: ResolvedPetPlan;
  petKey: string;
  petName: string;
  formData: FormData;
  suffix?: string;
}): Record<string, string> {
  const { config, plan, petKey, petName, formData, suffix = '' } = opts;
  const errors: Record<string, string> = {};
  const tail = suffix ? ` ${suffix}` : '';

  if (plan.askOutdoorAccess && config.outdoor.required) {
    const key = outdoorAccessKey(petKey);
    const value = String(formData[key] ?? '');
    if (value !== 'yes' && value !== 'no') {
      errors[key] = `Please answer "${fillPetName(config.outdoor.questionText, petName)}"${tail}`;
    }
  }
  for (const rule of plan.panelRules) {
    const options = rule.options ?? [];
    if (options.length === 0) continue;
    const key = panelAnswerKey(petKey, rule.id);
    const value = String(formData[key] ?? '');
    const valid = value === PANEL_DECLINED || options.some((o) => o.id === value) || value === PANEL_ACCEPTED;
    if (!valid) {
      errors[key] =
        options.length > 1
          ? `Please choose a lab option for ${petName}${tail}`
          : `Please answer the ${options[0].displayName} question for ${petName}${tail}`;
    }
  }
  for (const question of plan.itemQuestions) {
    if (!question.required) continue;
    const key = itemQuestionKey(petKey, question.id);
    const value = String(formData[key] ?? '');
    if (!question.choices.some((choice) => choice.id === value)) {
      errors[key] = `Please answer "${fillPetName(question.questionText, petName)}"${tail}`;
    }
  }
  return errors;
}
