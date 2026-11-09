import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Pencil, X } from 'lucide-react';
import MessageTemplateHtmlEditor from '../../messageTemplates/MessageTemplateHtmlEditor';
import OfferSection from '../../../pages/roomLoader/OfferSection';
import OutdoorAccessQuestion from '../../../pages/roomLoader/OutdoorAccessQuestion';
import ItemQuestionsSection from '../../../pages/roomLoader/ItemQuestionsSection';
import RoomLoaderLabsPage, { labsPageIsEmpty } from '../../../pages/roomLoader/RoomLoaderLabsPage';
import ChronicMedsSection, { type ChronicMed } from '../../../pages/roomLoader/ChronicMedsSection';
import ProductGuideSection from '../../../pages/roomLoader/ProductGuideSection';
import MembershipPitch from '../../../pages/roomLoader/MembershipPitch';
import RoomLoaderHtml from '../../../pages/roomLoader/RoomLoaderHtml';
import { splitDedupedOffers } from '../../../pages/roomLoader/roomLoaderConfigPlan';
import { outdoorAccessKey } from '../../../pages/roomLoader/roomLoaderFormKeys';
import { roomLoaderPriceLabel } from '../../../pages/roomLoader/RoomLoaderPrice';
import {
  ageWindowMatches,
  itemQuestionHistoryRefs,
  resolvePetPlan,
  speciesMatches,
  type EngineContext,
  type ResolvedOffer,
} from '../../../utils/roomLoaderOfferEngine';
import { fetchCatalogListPrice } from '../../../utils/roomLoaderCatalogPrice';
import type {
  RoomLoaderConfig,
  RoomLoaderItemQuestion,
  RoomLoaderItemRef,
  RoomLoaderPanelOption,
  RoomLoaderPanelRule,
  RoomLoaderSpecies,
} from '../../../utils/roomLoaderConfigTypes';
import './RoomLoaderPreviewTab.css';

/**
 * Settings → Room Loader → Preview. Shows the client form for a sample pet, built from the same
 * sections the live form uses and from the settings on screen (saved or not). Every block has an
 * "Edit wording" button that opens its text in large boxes right under it; the preview updates as
 * you type. Items, ages, history windows and prices stay on the Advanced tab.
 */

type Props = {
  practiceId: number;
  config: RoomLoaderConfig;
  setConfig: Dispatch<SetStateAction<RoomLoaderConfig | null>>;
  /** Opens the Advanced tab (items, ages, rules). */
  onOpenAdvanced: () => void;
};

type AgeChoice = 'young' | 'adult' | 'senior';
const AGE_MONTHS: Record<AgeChoice, number> = { young: 4, adult: 48, senior: 132 };
const AGE_LABEL: Record<RoomLoaderSpecies, Record<AgeChoice, string>> = {
  dog: { young: 'Puppy (4 months)', adult: 'Adult (4 years)', senior: 'Senior (11 years)' },
  cat: { young: 'Kitten (4 months)', adult: 'Adult (4 years)', senior: 'Senior (11 years)' },
};
const SAMPLE_NAME: Record<RoomLoaderSpecies, string> = { dog: 'Maple', cat: 'Juniper' };
const SAMPLE_DOCTOR = 'Dr. Lane';
const PET_KEY = 'preview0';

/* ------------------------------------------------------------ wording fields */

type WordingField = {
  key: string;
  label: string;
  kind: 'text' | 'html';
  value: string;
  onChange: (next: string) => void;
  hint?: string;
};

function WordingEditor({ fields }: { fields: WordingField[] }) {
  if (fields.length === 0) return <p className="rl-prev__empty">Nothing to word here.</p>;
  return (
    <div className="rl-prev__fields">
      {fields.map((field) =>
        field.kind === 'html' ? (
          <div className="rl-prev__field" key={field.key}>
            <span className="rl-prev__field-label">{field.label}</span>
            <MessageTemplateHtmlEditor
              value={field.value}
              onChange={field.onChange}
              placeholder="Write what the client should read."
              allowInlineImages={false}
            />
            {field.hint ? <em className="rl-prev__field-hint">{field.hint}</em> : null}
          </div>
        ) : (
          <label className="rl-prev__field" key={field.key}>
            <span className="rl-prev__field-label">{field.label}</span>
            <textarea
              className="rl-prev__textarea"
              rows={Math.max(2, Math.ceil((field.value || '').length / 70))}
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
            />
            {field.hint ? <em className="rl-prev__field-hint">{field.hint}</em> : null}
          </label>
        )
      )}
    </div>
  );
}

/** One block of the client form with its own "Edit wording" panel. */
function PreviewBlock({
  id,
  title,
  note,
  fields,
  editing,
  onEdit,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  fields: WordingField[];
  editing: string | null;
  onEdit: (id: string | null) => void;
  children: ReactNode;
}) {
  const open = editing === id;
  return (
    <section className={`rl-prev__block${open ? ' is-editing' : ''}`} data-block={id}>
      <header className="rl-prev__block-head">
        <span className="rl-prev__block-title">{title}</span>
        {fields.length > 0 ? (
          <button
            type="button"
            className="rl-prev__edit"
            aria-expanded={open}
            onClick={() => onEdit(open ? null : id)}
          >
            {open ? <X size={14} aria-hidden /> : <Pencil size={14} aria-hidden />}
            {open ? 'Done' : 'Edit wording'}
          </button>
        ) : null}
      </header>
      {note ? <div className="rl-prev__note">{note}</div> : null}
      <div className="rl-prev__client">{children}</div>
      {open ? <WordingEditor fields={fields} /> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ prices */

function usePrices(practiceId: number, refs: RoomLoaderItemRef[]) {
  const key = refs
    .map((ref) => `${ref.itemType}:${ref.itemId}`)
    .sort()
    .join(',');
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const [prices, setPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    const missing = refsRef.current.filter(
      (ref) => Number(ref.itemId) > 0 && prices[`${ref.itemType}:${ref.itemId}`] == null
    );
    if (!practiceId || missing.length === 0) return;
    void Promise.all(
      missing.map(async (ref) => ({
        k: `${ref.itemType}:${ref.itemId}`,
        p: await fetchCatalogListPrice(ref, practiceId),
      }))
    ).then((rows) => {
      if (cancelled) return;
      setPrices((prev) => {
        const next = { ...prev };
        for (const row of rows) if (row.p != null && Number.isFinite(row.p)) next[row.k] = row.p;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceId, key]);
  const amount = (item: { itemType: string; itemId: number }): number | null => {
    if (!(Number(item.itemId) > 0)) return null;
    return prices[`${item.itemType}:${item.itemId}`] ?? null;
  };
  const priceFor = (item: { itemType: string; itemId: number }) => {
    const value = amount(item);
    return value == null ? null : roomLoaderPriceLabel(value, null);
  };
  return { amount, priceFor };
}

const money = (n: number) => `$${n.toFixed(2)}`;

/* ------------------------------------------------------- the offered list */

type OfferedRow = {
  group: string;
  name: string | undefined;
  item: RoomLoaderItemRef | null;
  /** Panels sharing this key are a choose-one question: the client accepts one at most. */
  pickOne?: string;
};

type OfferedLine = { kind: 'pick-one' } | { kind: 'row'; row: OfferedRow & { name: string } };

/** The rows of one group, with a "Client picks one" line before each choose-one set. */
export function offeredLines(rows: Array<OfferedRow & { name: string }>): OfferedLine[] {
  const out: OfferedLine[] = [];
  let lastPick: string | undefined;
  for (const row of rows) {
    if (row.pickOne && row.pickOne !== lastPick) out.push({ kind: 'pick-one' });
    lastPick = row.pickOne;
    out.push({ kind: 'row', row });
  }
  return out;
}

/* --------------------------------------------- when an item question is asked */

const itemNames = (refs: RoomLoaderItemRef[]) =>
  Array.from(new Set(refs.map((r) => r.name || r.code || `item ${r.itemId}`)));

function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** Plain-English rule for when the client form asks this question. */
export function itemQuestionWhen(question: RoomLoaderItemQuestion, petName: string): string {
  const triggers = itemNames(question.triggerItems ?? []);
  let text =
    triggers.length > 0
      ? `Asked when staff put ${listOf(triggers)} on the visit`
      : 'Never asked: no visit item is chosen to trigger it';
  if (triggers.length > 0 && question.askOnlyIfNeverHad) {
    const history = itemNames(itemQuestionHistoryRefs(question));
    text += `, and only if ${petName} has never had ${listOf(history)}`;
  }
  const within = question.history?.suppressIfDoneWithinMonths;
  if (triggers.length > 0 && within) {
    text += `. Skipped if ${petName} had it in the last ${within} months`;
  }
  return `${text}.`;
}

/* ---------------------------------------------------------------- the tab */

export default function RoomLoaderPreviewTab({
  practiceId,
  config,
  setConfig,
  onOpenAdvanced,
}: Props) {
  const [species, setSpecies] = useState<RoomLoaderSpecies>('dog');
  const [age, setAge] = useState<AgeChoice>('adult');
  const [medicalConcern, setMedicalConcern] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [pitchOpen, setPitchOpen] = useState(false);
  const petName = SAMPLE_NAME[species];

  // A new sample pet starts a fresh form.
  useEffect(() => {
    setFormData({});
    setEditing(null);
  }, [species, age, medicalConcern]);

  const outdoorAnswer = formData[outdoorAccessKey(PET_KEY)];
  const ctx: EngineContext = useMemo(
    () => ({
      species,
      ageMonths: AGE_MONTHS[age],
      history: [],
      reminders: [],
      estimateLines: [],
      outdoorAccess: outdoorAnswer === 'yes' ? true : outdoorAnswer === 'no' ? false : null,
      medicalConcern,
    }),
    [species, age, medicalConcern, outdoorAnswer]
  );
  const plan = useMemo(() => resolvePetPlan(config, ctx), [config, ctx]);
  const { gated, universal } = splitDedupedOffers(plan);
  const onChange = (key: string, value: string) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  // Questions asked when a matching item is on the visit, for this species and age. Turned-off
  // ones stay listed (so they can be turned back on) but the client form leaves them out.
  const questionsForPet = (config.itemQuestions ?? []).filter(
    (q) => speciesMatches(q.species, species) && ageWindowMatches(q.age, AGE_MONTHS[age])
  );
  const itemQuestions = questionsForPet.filter((q) => q.enabled);
  const sampleInstructions = (config.sampleInstructions ?? []).filter(
    (s) => s.enabled && speciesMatches(s.species, species)
  );
  const productTables = (config.productGuide?.tables ?? []).filter((t) =>
    speciesMatches(t.species, species)
  );

  // `pickOne` groups panels the client chooses between: only one of them can be accepted.
  const allOffered: Array<OfferedRow & { name: string }> = [
    ...plan.panelRules.flatMap((rule) =>
      rule.options.map((o) => ({
        group: 'Lab work',
        name: o.displayName || o.item?.name,
        item: o.item,
        pickOne: rule.options.length > 1 ? `rule:${rule.id}` : undefined,
      }))
    ),
    ...plan.medicalConcernOptions.map((o) => ({
      group: 'Lab work',
      name: o.displayName || o.item?.name,
      item: o.item,
    })),
    ...(plan.outdoorPitch && ctx.outdoorAccess
      ? [
          {
            group: 'Care plan (outdoor cats)',
            name: plan.outdoorPitch.displayName,
            item: plan.outdoorPitch.item,
          },
        ]
      : []),
    ...gated.map((o) => ({ group: 'Care plan', name: o.displayName, item: o.item })),
    ...universal.map((o) => ({ group: 'Summary add-ons', name: o.displayName, item: o.item })),
  ].map((row) => ({ ...row, name: row.name || 'Unnamed item' }));
  const { amount, priceFor } = usePrices(
    practiceId,
    allOffered.map((row) => row.item).filter((x): x is RoomLoaderItemRef => !!x)
  );

  /* ---- setters for wording */
  const patch = <K extends keyof RoomLoaderConfig>(
    key: K,
    fn: (v: RoomLoaderConfig[K]) => RoomLoaderConfig[K]
  ) => setConfig((prev) => (prev ? { ...prev, [key]: fn(prev[key]) } : prev));
  const patchOffer = (
    offer: ResolvedOffer,
    field: 'displayName' | 'descriptionHtml' | 'cautionHtml',
    value: string
  ) => {
    if ((config.gatedOffers ?? []).some((o) => o.id === offer.id)) {
      patch('gatedOffers', (list) =>
        list.map((o) => (o.id === offer.id ? { ...o, [field]: value } : o))
      );
    } else if ((config.universalOffers ?? []).some((o) => o.id === offer.id)) {
      patch('universalOffers', (list) =>
        list.map((o) => (o.id === offer.id ? { ...o, [field]: value } : o))
      );
    }
  };
  const offerFields = (offers: ResolvedOffer[], withCaution: boolean): WordingField[] =>
    offers.flatMap((offer) => [
      {
        key: `${offer.id}-n`,
        label: `${offer.displayName}: name`,
        kind: 'text' as const,
        value: offer.displayName,
        onChange: (v: string) => patchOffer(offer, 'displayName', v),
      },
      {
        key: `${offer.id}-d`,
        label: `${offer.displayName}: description`,
        kind: 'html' as const,
        value: offer.descriptionHtml,
        onChange: (v: string) => patchOffer(offer, 'descriptionHtml', v),
      },
      ...(withCaution && (config.gatedOffers ?? []).some((o) => o.id === offer.id)
        ? [
            {
              key: `${offer.id}-c`,
              label: `${offer.displayName}: if they say no`,
              kind: 'html' as const,
              value: offer.cautionHtml,
              onChange: (v: string) => patchOffer(offer, 'cautionHtml', v),
              hint: 'Shown after the client unchecks it. Blank uses the default caution below.',
            },
          ]
        : []),
    ]);

  const patchRule = (id: string, p: Partial<RoomLoaderPanelRule>) =>
    patch('panelRules', (list) => list.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const patchRuleOption = (ruleId: string, optionId: string, p: Partial<RoomLoaderPanelOption>) =>
    patch('panelRules', (list) =>
      list.map((r) =>
        r.id === ruleId
          ? { ...r, options: r.options.map((o) => (o.id === optionId ? { ...o, ...p } : o)) }
          : r
      )
    );
  const patchConcernOption = (optionId: string, p: Partial<RoomLoaderPanelOption>) =>
    patch('medicalConcern', (mc) => ({
      ...mc,
      options: mc.options.map((o) => (o.id === optionId ? { ...o, ...p } : o)),
    }));

  const labFields: WordingField[] = [
    {
      key: 'lp-t',
      label: 'Page title',
      kind: 'text',
      value: config.labsPage.title,
      onChange: (v) => patch('labsPage', (lp) => ({ ...lp, title: v })),
    },
    medicalConcern
      ? {
          key: 'lp-mi',
          label: 'Page intro (staff flagged a medical concern)',
          kind: 'html',
          value: config.labsPage.medicalConcernIntroHtml,
          onChange: (v) => patch('labsPage', (lp) => ({ ...lp, medicalConcernIntroHtml: v })),
        }
      : {
          key: 'lp-i',
          label: 'Page intro',
          kind: 'html',
          value: config.labsPage.introHtml,
          onChange: (v) => patch('labsPage', (lp) => ({ ...lp, introHtml: v })),
        },
    ...plan.panelRules.flatMap((rule): WordingField[] => [
      medicalConcern
        ? {
            key: `${rule.id}-ci`,
            label: `${rule.label}: above the choices (medical concern)`,
            kind: 'html',
            value: rule.concernIntroHtml,
            onChange: (v) => patchRule(rule.id, { concernIntroHtml: v }),
            hint: 'Blank uses the routine text. {petName}, {doctorName}, {panel1}, {panel2} are filled in.',
          }
        : {
            key: `${rule.id}-i`,
            label: `${rule.label}: above the choices`,
            kind: 'html',
            value: rule.introHtml,
            onChange: (v) => patchRule(rule.id, { introHtml: v }),
            hint: '{petName}, {doctorName}, {panel1}, {panel2} are filled in.',
          },
      ...rule.options.flatMap((o): WordingField[] => [
        {
          key: `${o.id}-n`,
          label: `${o.displayName || o.item?.name}: name`,
          kind: 'text',
          value: o.displayName,
          onChange: (v) => patchRuleOption(rule.id, o.id, { displayName: v }),
        },
        {
          key: `${o.id}-d`,
          label: `${o.displayName || o.item?.name}: what's included`,
          kind: 'html',
          value: o.descriptionHtml,
          onChange: (v) => patchRuleOption(rule.id, o.id, { descriptionHtml: v }),
        },
      ]),
      medicalConcern
        ? {
            key: `${rule.id}-cc`,
            label: `${rule.label}: below the choices (medical concern)`,
            kind: 'html',
            value: rule.concernClosingHtml,
            onChange: (v) => patchRule(rule.id, { concernClosingHtml: v }),
          }
        : {
            key: `${rule.id}-c`,
            label: `${rule.label}: below the choices`,
            kind: 'html',
            value: rule.closingHtml,
            onChange: (v) => patchRule(rule.id, { closingHtml: v }),
          },
    ]),
    ...(plan.medicalConcernOptions.length
      ? [
          {
            key: 'mc-i',
            label: 'Medical concern: above the choices',
            kind: 'html' as const,
            value: config.medicalConcern.introHtml,
            onChange: (v: string) => patch('medicalConcern', (mc) => ({ ...mc, introHtml: v })),
          },
          ...plan.medicalConcernOptions.flatMap((o): WordingField[] => [
            {
              key: `${o.id}-n`,
              label: `${o.displayName || o.item?.name}: name`,
              kind: 'text',
              value: o.displayName,
              onChange: (v) => patchConcernOption(o.id, { displayName: v }),
            },
            {
              key: `${o.id}-d`,
              label: `${o.displayName || o.item?.name}: what's included`,
              kind: 'html',
              value: o.descriptionHtml,
              onChange: (v) => patchConcernOption(o.id, { descriptionHtml: v }),
            },
          ]),
        ]
      : []),
    ...sampleInstructions.flatMap((s): WordingField[] => [
      {
        key: `${s.id}-h`,
        label: `Sample card "${s.label}": heading`,
        kind: 'text',
        value: s.heading,
        onChange: (v) =>
          patch('sampleInstructions', (l) =>
            l.map((x) => (x.id === s.id ? { ...x, heading: v } : x))
          ),
      },
      {
        key: `${s.id}-b`,
        label: `Sample card "${s.label}": how to collect`,
        kind: 'html',
        value: s.bodyHtml,
        onChange: (v) =>
          patch('sampleInstructions', (l) =>
            l.map((x) => (x.id === s.id ? { ...x, bodyHtml: v } : x))
          ),
        hint: 'Shown once the client accepts a test that needs a sample.',
      },
    ]),
  ];

  const outdoor = config.outdoor;
  const outdoorFields: WordingField[] = [
    {
      key: 'od-q',
      label: 'Question',
      kind: 'text',
      value: outdoor.questionText,
      onChange: (v) => patch('outdoor', (o) => ({ ...o, questionText: v })),
      hint: '{petName} is filled in.',
    },
    {
      key: 'od-p',
      label: 'Shown after "Yes"',
      kind: 'html',
      value: outdoor.pitchHtml,
      onChange: (v) => patch('outdoor', (o) => ({ ...o, pitchHtml: v })),
    },
    {
      key: 'od-n',
      label: 'Name of the offered vaccine',
      kind: 'text',
      value: outdoor.pitchDisplayName,
      onChange: (v) => patch('outdoor', (o) => ({ ...o, pitchDisplayName: v })),
      hint: `Blank uses the catalog name (${outdoor.pitchItem?.name ?? 'no item chosen'}).`,
    },
    {
      key: 'od-c',
      label: 'If they say no',
      kind: 'html',
      value: outdoor.pitchCautionHtml,
      onChange: (v) => patch('outdoor', (o) => ({ ...o, pitchCautionHtml: v })),
    },
  ];

  const questionFields: WordingField[] = itemQuestions.flatMap((q): WordingField[] => [
    {
      key: `${q.id}-q`,
      label: `${q.label}: question`,
      kind: 'text',
      value: q.questionText,
      onChange: (v) =>
        patch('itemQuestions', (l) =>
          l.map((x) => (x.id === q.id ? { ...x, questionText: v } : x))
        ),
    },
    {
      key: `${q.id}-h`,
      label: `${q.label}: help text`,
      kind: 'html',
      value: q.helpHtml,
      onChange: (v) =>
        patch('itemQuestions', (l) => l.map((x) => (x.id === q.id ? { ...x, helpHtml: v } : x))),
    },
    ...q.choices.map(
      (c): WordingField => ({
        key: `${q.id}-${c.id}`,
        label: `${q.label}: answer`,
        kind: 'text',
        value: c.label,
        onChange: (v) =>
          patch('itemQuestions', (l) =>
            l.map((x) =>
              x.id === q.id
                ? { ...x, choices: x.choices.map((y) => (y.id === c.id ? { ...y, label: v } : y)) }
                : x
            )
          ),
      })
    ),
  ]);

  const declineFields: WordingField[] = [
    ...(config.declineReasons ?? []).map(
      (r): WordingField => ({
        key: r.id,
        label: r.label,
        kind: 'html',
        value: r.html,
        onChange: (v) =>
          patch('declineReasons', (l) => l.map((x) => (x.id === r.id ? { ...x, html: v } : x))),
      })
    ),
    {
      key: 'default-caution',
      label: 'Anything else (default)',
      kind: 'html',
      value: config.defaultDeclineCautionHtml,
      onChange: (v) =>
        setConfig((prev) => (prev ? { ...prev, defaultDeclineCautionHtml: v } : prev)),
    },
  ];

  const m = config.membership;
  const membershipFields: WordingField[] = [
    {
      key: 'm-h',
      label: 'Headline',
      kind: 'text',
      value: m.headline,
      onChange: (v) => patch('membership', (x) => ({ ...x, headline: v })),
    },
    {
      key: 'm-s',
      label: 'Under the headline',
      kind: 'html',
      value: m.subheadHtml,
      onChange: (v) => patch('membership', (x) => ({ ...x, subheadHtml: v })),
    },
    {
      key: 'm-e',
      label: 'Button to open the comparison',
      kind: 'text',
      value: m.expandLabel,
      onChange: (v) => patch('membership', (x) => ({ ...x, expandLabel: v })),
    },
    {
      key: 'm-c',
      label: 'Button to close it',
      kind: 'text',
      value: m.collapseLabel,
      onChange: (v) => patch('membership', (x) => ({ ...x, collapseLabel: v })),
    },
  ];

  const cm = config.chronicMeds;
  const chronicFields: WordingField[] = [
    {
      key: 'cm-q',
      label: 'Question',
      kind: 'text',
      value: cm.questionText,
      onChange: (v) => patch('chronicMeds', (x) => ({ ...x, questionText: v })),
      hint: '{petName} is filled in.',
    },
    {
      key: 'cm-i',
      label: 'Intro',
      kind: 'html',
      value: cm.introHtml,
      onChange: (v) => patch('chronicMeds', (x) => ({ ...x, introHtml: v })),
    },
    ...(cm.allowBring
      ? [
          {
            key: 'cm-b',
            label: '"Bring it" choice',
            kind: 'text' as const,
            value: cm.bringLabel,
            onChange: (v: string) => patch('chronicMeds', (x) => ({ ...x, bringLabel: v })),
          },
        ]
      : []),
    ...(cm.allowShip
      ? [
          {
            key: 'cm-s',
            label: '"Ship it" choice',
            kind: 'text' as const,
            value: cm.shipLabel,
            onChange: (v: string) => patch('chronicMeds', (x) => ({ ...x, shipLabel: v })),
          },
        ]
      : []),
    ...(cm.allowFreeText
      ? [
          {
            key: 'cm-f',
            label: '"Something else" box',
            kind: 'text' as const,
            value: cm.freeTextLabel,
            onChange: (v: string) => patch('chronicMeds', (x) => ({ ...x, freeTextLabel: v })),
          },
        ]
      : []),
  ];
  const sampleMeds: ChronicMed[] = [
    {
      prescriptionId: -1,
      name: species === 'cat' ? 'Methimazole' : 'Apoquel',
      strength: species === 'cat' ? '2.5 mg' : '16 mg',
      instructions:
        species === 'cat'
          ? 'Give 1 tablet by mouth twice daily'
          : 'Give 1 tablet by mouth once daily',
      inventoryItemId: null,
      refillsRemaining: 2,
      autoshipActive: false,
    },
  ];

  const guide = config.productGuide;
  const guideFields: WordingField[] = [
    {
      key: 'pg-s',
      label: 'Link text',
      kind: 'text',
      value: guide.summaryLabel,
      onChange: (v) => patch('productGuide', (x) => ({ ...x, summaryLabel: v })),
    },
    ...productTables.flatMap((t): WordingField[] => [
      {
        key: `${t.id}-h`,
        label: `${t.heading}: heading`,
        kind: 'text',
        value: t.heading,
        onChange: (v) =>
          patch('productGuide', (x) => ({
            ...x,
            tables: x.tables.map((y) => (y.id === t.id ? { ...y, heading: v } : y)),
          })),
      },
      {
        key: `${t.id}-n`,
        label: `${t.heading}: above the table`,
        kind: 'html',
        value: t.noteHtml,
        onChange: (v) =>
          patch('productGuide', (x) => ({
            ...x,
            tables: x.tables.map((y) => (y.id === t.id ? { ...y, noteHtml: v } : y)),
          })),
      },
      {
        key: `${t.id}-f`,
        label: `${t.heading}: below the table`,
        kind: 'html',
        value: t.footerHtml,
        onChange: (v) =>
          patch('productGuide', (x) => ({
            ...x,
            tables: x.tables.map((y) => (y.id === t.id ? { ...y, footerHtml: v } : y)),
          })),
      },
    ]),
  ];

  // A client can accept only one panel of a pick-one group, so count its dearest panel once.
  const offeredTotal = (() => {
    let sum = 0;
    const dearest = new Map<string, number>();
    for (const row of allOffered) {
      const price = row.item ? (amount(row.item) ?? 0) : 0;
      if (row.pickOne) dearest.set(row.pickOne, Math.max(dearest.get(row.pickOne) ?? 0, price));
      else sum += price;
    }
    return sum + Array.from(dearest.values()).reduce((a, b) => a + b, 0);
  })();
  const groups = Array.from(new Set(allOffered.map((r) => r.group)));
  const blockProps = { editing, onEdit: setEditing };

  return (
    <div className="rl-prev">
      <div className="rl-prev__pet" role="group" aria-label="Sample pet">
        <span className="rl-prev__pet-title">Preview as</span>
        <div className="rl-prev__seg" role="radiogroup" aria-label="Species">
          {(['dog', 'cat'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={species === s}
              className={species === s ? 'is-on' : ''}
              onClick={() => setSpecies(s)}
            >
              {s === 'dog' ? 'Dog' : 'Cat'}
            </button>
          ))}
        </div>
        <div className="rl-prev__seg" role="radiogroup" aria-label="Age">
          {(['young', 'adult', 'senior'] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={age === a}
              className={age === a ? 'is-on' : ''}
              onClick={() => setAge(a)}
            >
              {AGE_LABEL[species][a]}
            </button>
          ))}
        </div>
        <label className="rl-prev__check">
          <input
            type="checkbox"
            checked={medicalConcern}
            onChange={(e) => setMedicalConcern(e.target.checked)}
          />
          Staff flagged a medical concern
        </label>
        <span className="rl-prev__pet-hint">
          A pet with no history and nothing on the visit yet. Answers you click below are not saved.
        </span>
      </div>

      <div className="rl-prev__layout">
        <aside className="rl-prev__offered" aria-label="What this pet is offered">
          <h3>What {petName} is offered</h3>
          <p className="rl-prev__note">
            On top of what staff put on the visit. List prices from the catalog; members and client
            discounts can change them.
          </p>
          {allOffered.length === 0 ? (
            <p className="rl-prev__empty">Nothing extra for this pet.</p>
          ) : (
            groups.map((g) => (
              <div key={g} className="rl-prev__offered-group">
                <h4>{g}</h4>
                <ul>
                  {offeredLines(allOffered.filter((r) => r.group === g)).map((line, i) =>
                    line.kind === 'pick-one' ? (
                      <li key={`${g}-${i}`} className="rl-prev__pick-one">
                        Client picks one (or none):
                      </li>
                    ) : (
                      <li
                        key={`${g}-${i}`}
                        className={line.row.pickOne ? 'rl-prev__in-pick-one' : undefined}
                      >
                        <span className="rl-prev__offered-name">
                          {line.row.name}
                          {line.row.item ? (
                            <small className="rl-prev__item">
                              adds: {line.row.item.name}
                              {line.row.item.code ? ` (${line.row.item.code})` : ''}
                            </small>
                          ) : (
                            <small className="rl-prev__item is-missing">
                              no catalog item chosen
                            </small>
                          )}
                        </span>
                        <span className="rl-prev__price">
                          {line.row.item && amount(line.row.item) != null
                            ? money(amount(line.row.item) as number)
                            : ''}
                        </span>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))
          )}
          {offeredTotal > 0 ? (
            <p className="rl-prev__offered-total">
              If they said yes to everything: <strong>{money(offeredTotal)}</strong>
              {allOffered.some((r) => r.pickOne) ? (
                <small> (the dearest panel where they pick one)</small>
              ) : null}
            </p>
          ) : null}
          {species === 'cat' && plan.askOutdoorAccess && outdoorAnswer !== 'yes' ? (
            <p className="rl-prev__note">
              Answer “Yes” to the outdoor question to see what outdoor cats are offered.
            </p>
          ) : null}
          <button type="button" className="btn secondary btn-sm" onClick={onOpenAdvanced}>
            Change items, ages or rules (Advanced)
          </button>
        </aside>

        <div className="rl-prev__pages">
          <h2 className="rl-prev__page">1. Care plan</h2>
          <PreviewBlock
            id="decline"
            title="When the client unchecks something that's due"
            note="Staff's due items are listed first on the care plan. If the client unchecks one, this is the reason they read under it."
            fields={declineFields}
            {...blockProps}
          >
            <ul className="rl-prev__reasons">
              {(config.declineReasons ?? []).map((r) => (
                <li key={r.id}>
                  <strong>{r.label}</strong>
                  <RoomLoaderHtml html={r.html} />
                </li>
              ))}
            </ul>
          </PreviewBlock>

          {plan.askOutdoorAccess ? (
            <PreviewBlock
              id="outdoor"
              title="Outdoor question"
              note='Try answering "Yes".'
              fields={outdoorFields}
              {...blockProps}
            >
              <OutdoorAccessQuestion
                petKey={PET_KEY}
                petName={petName}
                config={outdoor}
                pitch={plan.outdoorPitch}
                formData={formData}
                onChange={onChange}
                priceFor={priceFor}
              />
            </PreviewBlock>
          ) : null}

          {gated.length > 0 ? (
            <PreviewBlock
              id="gated"
              title="Optional vaccines & add-ons"
              fields={offerFields(gated, true)}
              {...blockProps}
            >
              <OfferSection
                petKey={PET_KEY}
                title={`Optional vaccines & add-ons for ${petName}`}
                petName={petName}
                offers={gated}
                formData={formData}
                onChange={onChange}
                priceFor={priceFor}
              />
            </PreviewBlock>
          ) : null}

          {questionsForPet.length > 0 ? (
            <PreviewBlock
              id="questions"
              title="Questions about items on the visit"
              note={
                <>
                  Shown here so you can read them; a client sees each one only when its rule below
                  matches.
                  <ul className="rl-prev__when">
                    {questionsForPet.map((q) => (
                      <li key={q.id}>
                        <label className="rl-prev__when-toggle">
                          <input
                            type="checkbox"
                            checked={q.enabled}
                            onChange={(e) =>
                              patch('itemQuestions', (l) =>
                                l.map((x) =>
                                  x.id === q.id ? { ...x, enabled: e.target.checked } : x
                                )
                              )
                            }
                          />
                          Ask “{q.label}”
                        </label>
                        <span>
                          {q.enabled
                            ? itemQuestionWhen(q, petName)
                            : 'Off: clients are not asked this.'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              }
              fields={questionFields}
              {...blockProps}
            >
              {itemQuestions.length > 0 ? (
                <ItemQuestionsSection
                  petKey={PET_KEY}
                  petName={petName}
                  questions={itemQuestions}
                  formData={formData}
                  onChange={onChange}
                />
              ) : (
                <p className="rl-prev__empty">All questions for this pet are turned off.</p>
              )}
            </PreviewBlock>
          ) : null}

          <h2 className="rl-prev__page">2. Lab work</h2>
          {labsPageIsEmpty(plan) ? (
            <p className="rl-prev__empty">
              No lab work is offered to this pet
              {medicalConcern ? '' : '. Try "Staff flagged a medical concern" or another age'}.
            </p>
          ) : (
            <PreviewBlock
              id="labs"
              title="Lab work page"
              note="Pick a panel to see sample collection cards."
              fields={labFields}
              {...blockProps}
            >
              <RoomLoaderLabsPage
                config={config}
                petKey={PET_KEY}
                petName={petName}
                plan={plan}
                ctx={ctx}
                formData={formData}
                onChange={onChange}
                priceFor={priceFor}
                errors={{}}
                doctorName={SAMPLE_DOCTOR}
              />
            </PreviewBlock>
          )}

          <h2 className="rl-prev__page">3. Summary</h2>
          {universal.length > 0 ? (
            <PreviewBlock
              id="universal"
              title="Add-ons offered to everyone"
              fields={offerFields(universal, false)}
              {...blockProps}
            >
              <OfferSection
                petKey={PET_KEY}
                title={`Would you like to add anything else for ${petName}?`}
                offers={universal}
                formData={formData}
                onChange={onChange}
                priceFor={priceFor}
              />
            </PreviewBlock>
          ) : null}

          {cm.enabled ? (
            <PreviewBlock
              id="chronic"
              title="Refills for medications the pet takes"
              note="Shown only for pets with an active prescription. The medication here is a sample."
              fields={chronicFields}
              {...blockProps}
            >
              <ChronicMedsSection
                petKey={PET_KEY}
                petName={petName}
                config={cm}
                meds={sampleMeds}
                formData={formData}
                onChange={onChange}
              />
            </PreviewBlock>
          ) : null}

          {m.enabled ? (
            <PreviewBlock
              id="membership"
              title="Membership"
              note="Shown to families with a pet who isn't a member. The amounts here are samples; on the form they are this family's real prices with the recommended plan."
              fields={membershipFields}
              {...blockProps}
            >
              <MembershipPitch
                config={m}
                savings={186}
                rows={[
                  { name: 'Annual Wellness Visit', originalPrice: 118, adjustedPrice: 0 },
                  { name: 'Trip Fee', originalPrice: 108, adjustedPrice: 0 },
                ]}
                expanded={pitchOpen}
                onToggle={setPitchOpen}
                expandLabel={
                  m.expandLabel?.trim() || 'Expand to see how membership could change your bill'
                }
                collapseLabel={m.collapseLabel?.trim() || 'Hide the comparison'}
                formatPrice={money}
              >
                <p className="rl-prev__note">
                  The family’s plan comparison appears here: what the recommended plan covers on
                  this visit, why families join, and the button to enroll.
                </p>
              </MembershipPitch>
            </PreviewBlock>
          ) : null}

          {guide.enabled && productTables.length > 0 ? (
            <PreviewBlock
              id="guide"
              title="Prevention guide"
              note="Rows of the table are edited on the Advanced tab."
              fields={guideFields}
              {...blockProps}
            >
              <ProductGuideSection config={guide} speciesOnForm={[species]} />
            </PreviewBlock>
          ) : null}
        </div>
      </div>
    </div>
  );
}
