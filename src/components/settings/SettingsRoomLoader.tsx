import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useSpeciesCatalog } from '../pims/detail/SpeciesBreedFields';
import {
  ROOM_LOADER_ALL_SPECIES,
  asSpeciesSelection,
  describeSpeciesSelection,
  speciesOptionsForEditor,
  speciesSelectionIsAll,
  speciesSlug,
  type SpeciesCatalogRow,
} from '../../utils/roomLoaderSpecies';
import type { RoomLoaderSpeciesSelection } from '../../utils/roomLoaderConfigTypes';
import { ChevronDown, ChevronRight, ChevronUp, Eye, Plus, Trash2 } from 'lucide-react';
import LabPanelsSection from '../../pages/roomLoader/LabPanelsSection';
import {
  medicalConcernPanelRules,
  type EngineContext,
} from '../../utils/roomLoaderOfferEngine';
import {
  emptyHistoryGate,
  ensureRoomLoaderConfigSeeded,
  newRoomLoaderId,
  vaydDeclineReasons,
  vaydItemQuestions,
  vaydRoomLoaderConfigSeed,
  vaydSampleInstructions,
  vaydVaccineGatedOffers,
  type RoomLoaderProductGuideConfig,
  type RoomLoaderProductGuideTable,
  type RoomLoaderProductGuideRow,
  saveRoomLoaderConfig,
  type RoomLoaderAgeWindow,
  type RoomLoaderChronicMedsConfig,
  type RoomLoaderConfig,
  type RoomLoaderDeclineReason,
  type RoomLoaderGatedOffer,
  type RoomLoaderHistoryGate,
  type RoomLoaderItemQuestion,
  type RoomLoaderItemRef,
  type RoomLoaderLabsPageConfig,
  type RoomLoaderQuestionChoice,
  type RoomLoaderMedicalConcernConfig,
  type RoomLoaderMembershipConfig,
  type RoomLoaderOutdoorConfig,
  type RoomLoaderPanelOption,
  type RoomLoaderPanelRule,
  type RoomLoaderPanelSubAsk,
  type RoomLoaderSampleInstruction,
  type RoomLoaderSpecies,
  type RoomLoaderUniversalOffer,
} from '../../api/roomLoaderConfig';
import { getBundle, listBundles } from '../../api/memberships';
import {
  coveringFamiliesForItem,
  coveringPlansLabel,
  membershipCutoffHint,
  membershipPlanAgeDisagreement,
  membershipPlanFamily,
  formatPlanAge,
  planFitsRuleSpecies,
  mismatchesForRule,
  plansFromBundles,
  snapAgeToPlan,
  type MembershipAlignPlan,
} from '../../utils/roomLoaderMembershipAlign';
import CatalogItemPicker, { type PickedCatalogItem } from '../catalog/CatalogItemPicker';
import MessageTemplateHtmlEditor from '../messageTemplates/MessageTemplateHtmlEditor';
import {
  fetchCatalogListPrice,
  itemRefsFromPanelRules,
} from '../../utils/roomLoaderCatalogPrice';
import { roomLoaderPriceLabel } from '../../pages/roomLoader/RoomLoaderPrice';
import { fileToEmbeddedImageDataUrl } from '../../utils/embedImageDataUrl';
import { appConfirm } from '../../utils/appDialog';
import './SettingsRoomLoader.css';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

const PET_NAME_HINT = 'Write {petName} where the pet’s name should go.';

const PLACEMENT_OPTIONS: { value: RoomLoaderMembershipConfig['placement']; label: string }[] = [
  { value: 'top', label: 'Above the estimate' },
  { value: 'before-total', label: 'Just above the total' },
];

type AgeUnit = 'months' | 'years';

function numOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Panel options and sub-asks always carry an item, so a fresh row starts on this
 * placeholder and counts as unpicked until the catalog picker fills in a real id.
 */
function emptyItemRef(): RoomLoaderItemRef {
  return { itemType: 'lab', itemId: 0, name: '', code: null };
}

function toPicked(ref: RoomLoaderItemRef | null): PickedCatalogItem | null {
  if (!ref || ref.itemId <= 0) return null;
  return {
    itemType: ref.itemType,
    catalogItemId: ref.itemId,
    name: ref.name,
    code: ref.code,
    price: null,
  };
}

function fromPicked(picked: PickedCatalogItem | null): RoomLoaderItemRef | null {
  if (!picked) return null;
  return {
    itemType: picked.itemType,
    itemId: picked.catalogItemId,
    name: picked.name,
    code: picked.code,
  };
}

function itemLabel(ref: RoomLoaderItemRef | null): string {
  return ref && ref.itemId > 0 ? ref.name : '';
}

function moveAt<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  return next;
}

function resequence<T extends { sortOrder: number }>(list: T[]): T[] {
  return list.map((row, i) => (row.sortOrder === i ? row : { ...row, sortOrder: i }));
}

/** Starter rows this practice has not adopted yet, so re-running the action is harmless. */
function missingById<T extends { id: string }>(list: T[], starters: T[]): T[] {
  const have = new Set(list.map((row) => row.id));
  return starters.filter((row) => !have.has(row.id));
}

function bySortOrder(a: { sortOrder: number }, b: { sortOrder: number }): number {
  return a.sortOrder - b.sortOrder;
}

/** Stored order is whatever `sortOrder` says; the editor then works in array order. */
function sortedConfig(config: RoomLoaderConfig): RoomLoaderConfig {
  return {
    ...config,
    panelRules: [...config.panelRules].sort(bySortOrder),
    universalOffers: [...config.universalOffers].sort(bySortOrder),
    gatedOffers: [...config.gatedOffers].sort(bySortOrder),
    sampleInstructions: [...(config.sampleInstructions ?? [])].sort(bySortOrder),
  };
}

function formatAgeMonths(months: number): string {
  if (months <= 0) return 'birth';
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? '1 year' : `${years} years`;
  }
  return months === 1 ? '1 month' : `${months} months`;
}

function describeAgeWindow(
  species: RoomLoaderSpecies | RoomLoaderSpeciesSelection,
  age: RoomLoaderAgeWindow,
  catalog: readonly SpeciesCatalogRow[] = []
): string {
  const who = describeSpeciesSelection(species, catalog);
  const from = age.minMonths > 0 ? formatAgeMonths(age.minMonths) : null;
  const to = age.maxMonths == null ? null : formatAgeMonths(age.maxMonths);
  if (!from && !to) return `${who}, any age`;
  if (!from) return `${who}, under ${to}`;
  if (!to) return `${who}, ${from} and up`;
  return `${who}, ${from} up to ${to}`;
}

function inferAgeUnit(age: RoomLoaderAgeWindow): AgeUnit {
  const bounds = [age.minMonths, age.maxMonths].filter((m): m is number => m != null && m > 0);
  if (bounds.length === 0) return 'months';
  return bounds.every((m) => m % 12 === 0) ? 'years' : 'months';
}

function ageInputText(months: number | null, unit: AgeUnit): string {
  if (months == null) return '';
  return String(unit === 'years' ? months / 12 : months);
}

function newPanelOption(): RoomLoaderPanelOption {
  return {
    id: newRoomLoaderId('opt'),
    item: emptyItemRef(),
    displayName: '',
    descriptionHtml: '',
    imageUrl: null,
    imageCaption: '',
    replacesItems: [],
    subAsks: [],
  };
}

function newSubAsk(): RoomLoaderPanelSubAsk {
  return {
    id: newRoomLoaderId('ask'),
    item: emptyItemRef(),
    displayName: '',
    cautionHtml: '',
    requiresOutdoorAccess: false,
    history: emptyHistoryGate(),
  };
}

function newPanelRule(sortOrder: number): RoomLoaderPanelRule {
  return {
    id: newRoomLoaderId('rule'),
    label: '',
    enabled: true,
    species: [ROOM_LOADER_ALL_SPECIES],
    age: { minMonths: 0, maxMonths: null },
    introHtml: '',
    concernIntroHtml: '',
    closingHtml: '',
    concernClosingHtml: '',
    alignPackageId: null,
    options: [],
    sortOrder,
  };
}

function newUniversalOffer(sortOrder: number): RoomLoaderUniversalOffer {
  return {
    id: newRoomLoaderId('uni'),
    enabled: true,
    displayName: '',
    species: [ROOM_LOADER_ALL_SPECIES],
    descriptionHtml: '',
    item: null,
    itemBySpecies: { dog: null, cat: null },
    sortOrder,
  };
}

function newProductGuideRow(): RoomLoaderProductGuideRow {
  return {
    id: newRoomLoaderId('row'),
    approach: '',
    medication: '',
    schedule: '',
    coversHtml: '',
  };
}

function newProductGuideTable(sortOrder: number): RoomLoaderProductGuideTable {
  return {
    id: newRoomLoaderId('guide'),
    species: ['dog'],
    heading: '',
    noteHtml: '',
    rows: [newProductGuideRow()],
    footerHtml: '',
    sortOrder,
  };
}

function newGatedOffer(sortOrder: number): RoomLoaderGatedOffer {
  return {
    id: newRoomLoaderId('gate'),
    enabled: true,
    displayName: '',
    species: [ROOM_LOADER_ALL_SPECIES],
    item: null,
    equivalentItems: [],
    age: { minMonths: 0, maxMonths: null },
    history: emptyHistoryGate(),
    requiresOutdoorAccess: false,
    descriptionHtml: '',
    cautionHtml: '',
    sortOrder,
  };
}

function newDeclineReason(): RoomLoaderDeclineReason {
  return { id: newRoomLoaderId('why'), label: '', items: [], html: '' };
}

function newItemQuestion(sortOrder: number): RoomLoaderItemQuestion {
  return {
    id: newRoomLoaderId('ask'),
    enabled: true,
    label: '',
    species: [ROOM_LOADER_ALL_SPECIES],
    age: { minMonths: 0, maxMonths: null },
    triggerItems: [],
    historyItems: [],
    askOnlyIfNeverHad: false,
    history: emptyHistoryGate(),
    questionText: '',
    helpHtml: '',
    required: true,
    choices: [],
    sortOrder,
  };
}

function newSampleInstruction(sortOrder: number): RoomLoaderSampleInstruction {
  return {
    id: newRoomLoaderId('sample'),
    enabled: true,
    label: '',
    species: [ROOM_LOADER_ALL_SPECIES],
    triggerItems: [],
    heading: '',
    bodyHtml: '',
    sortOrder,
  };
}

function newQuestionChoice(): RoomLoaderQuestionChoice {
  return { id: newRoomLoaderId('opt'), label: '' };
}

const SpeciesCatalogContext = createContext<SpeciesCatalogRow[]>([]);

function useEditorSpeciesCatalog(): SpeciesCatalogRow[] {
  return useContext(SpeciesCatalogContext);
}

type Props = {
  practiceId: number;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

class RoomLoaderPaneBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SettingsRoomLoader]', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="settings-message settings-error-message">
        That image could not be added. Refresh this tab and try a smaller PNG or JPEG.
        <button type="button" className="btn secondary btn-sm" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

function SettingsRoomLoaderEditor({ practiceId, onMessage }: Props) {
  const [config, setConfig] = useState<RoomLoaderConfig | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [alignPlans, setAlignPlans] = useState<MembershipAlignPlan[]>([]);
  const speciesCatalog = useSpeciesCatalog(practiceId);

  const notify = useCallback(
    (msg: string, kind: 'success' | 'error') => onMessage?.(msg, kind),
    [onMessage]
  );

  const adopt = useCallback((next: RoomLoaderConfig) => {
    const ordered = sortedConfig(next);
    setConfig(ordered);
    try {
      setSavedJson(JSON.stringify(ordered));
    } catch {
      setSavedJson('');
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      adopt(await ensureRoomLoaderConfigSeeded());
    } catch (err) {
      setLoadError(extractErr(err));
    } finally {
      setLoading(false);
    }
  }, [adopt]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listed = await listBundles({ kind: 'membership' });
        const needDetail = listed.filter((bundle) => {
          if (bundle.isArchived || bundle.isActive === false) return false;
          if (!membershipPlanFamily(bundle.name)) return false;
          return !bundle.groups?.some((group) => (group.items ?? []).length > 0);
        });
        const detailed =
          needDetail.length === 0
            ? listed
            : await Promise.all(
                listed.map((bundle) =>
                  needDetail.some((row) => row.id === bundle.id)
                    ? getBundle(bundle.id).catch(() => bundle)
                    : Promise.resolve(bundle)
                )
              );
        if (!cancelled) setAlignPlans(plansFromBundles(detailed));
      } catch {
        if (!cancelled) setAlignPlans([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => {
    if (config == null) return false;
    try {
      return JSON.stringify(config) !== savedJson;
    } catch {
      return true;
    }
  }, [config, savedJson]);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      adopt(await saveRoomLoaderConfig(config));
      notify('Room Loader settings saved.', 'success');
    } catch (err) {
      notify(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  }, [config, adopt, notify]);

  const loadStarter = useCallback(async () => {
    const ok = await appConfirm({
      title: 'Load VAYD starter settings',
      message:
        'This replaces the Room Loader settings on this practice with the VAYD starter document from this release (panels, copy, offers, and medical-concern overwrite). Save happens immediately.',
      confirmLabel: 'Load starter settings',
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      adopt(await saveRoomLoaderConfig(vaydRoomLoaderConfigSeed()));
      notify('VAYD starter Room Loader settings saved for this practice.', 'success');
    } catch (err) {
      notify(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  }, [adopt, notify]);

  const onError = useCallback((msg: string) => notify(msg, 'error'), [notify]);

  const setPanelRules = useCallback(
    (fn: (list: RoomLoaderPanelRule[]) => RoomLoaderPanelRule[]) => {
      setConfig((prev) => (prev ? { ...prev, panelRules: fn(prev.panelRules) } : prev));
    },
    []
  );

  const setUniversalOffers = useCallback(
    (fn: (list: RoomLoaderUniversalOffer[]) => RoomLoaderUniversalOffer[]) => {
      setConfig((prev) => (prev ? { ...prev, universalOffers: fn(prev.universalOffers) } : prev));
    },
    []
  );

  const setGatedOffers = useCallback(
    (fn: (list: RoomLoaderGatedOffer[]) => RoomLoaderGatedOffer[]) => {
      setConfig((prev) => (prev ? { ...prev, gatedOffers: fn(prev.gatedOffers) } : prev));
    },
    []
  );

  const setDeclineReasons = useCallback(
    (fn: (list: RoomLoaderDeclineReason[]) => RoomLoaderDeclineReason[]) => {
      setConfig((prev) =>
        prev ? { ...prev, declineReasons: fn(prev.declineReasons ?? []) } : prev
      );
    },
    []
  );

  const setItemQuestions = useCallback(
    (fn: (list: RoomLoaderItemQuestion[]) => RoomLoaderItemQuestion[]) => {
      setConfig((prev) => (prev ? { ...prev, itemQuestions: fn(prev.itemQuestions ?? []) } : prev));
    },
    []
  );

  const setSampleInstructions = useCallback(
    (fn: (list: RoomLoaderSampleInstruction[]) => RoomLoaderSampleInstruction[]) => {
      setConfig((prev) =>
        prev ? { ...prev, sampleInstructions: fn(prev.sampleInstructions ?? []) } : prev
      );
    },
    []
  );

  const patchOutdoor = useCallback((patch: Partial<RoomLoaderOutdoorConfig>) => {
    setConfig((prev) => (prev ? { ...prev, outdoor: { ...prev.outdoor, ...patch } } : prev));
  }, []);

  const patchMedicalConcern = useCallback((patch: Partial<RoomLoaderMedicalConcernConfig>) => {
    setConfig((prev) =>
      prev ? { ...prev, medicalConcern: { ...prev.medicalConcern, ...patch } } : prev
    );
  }, []);

  const patchMembership = useCallback((patch: Partial<RoomLoaderMembershipConfig>) => {
    setConfig((prev) => (prev ? { ...prev, membership: { ...prev.membership, ...patch } } : prev));
  }, []);

  const patchChronicMeds = useCallback((patch: Partial<RoomLoaderChronicMedsConfig>) => {
    setConfig((prev) =>
      prev ? { ...prev, chronicMeds: { ...prev.chronicMeds, ...patch } } : prev
    );
  }, []);

  const patchLabsPage = useCallback((patch: Partial<RoomLoaderLabsPageConfig>) => {
    setConfig((prev) => (prev ? { ...prev, labsPage: { ...prev.labsPage, ...patch } } : prev));
  }, []);

  const patchProductGuide = useCallback((patch: Partial<RoomLoaderProductGuideConfig>) => {
    setConfig((prev) =>
      prev ? { ...prev, productGuide: { ...prev.productGuide, ...patch } } : prev
    );
  }, []);

  if (loading) {
    return (
      <div className="settings-loading">
        <div className="settings-spinner"></div>
        <span>Loading Room Loader settings…</span>
      </div>
    );
  }

  if (loadError || !config) {
    return (
      <div className="settings-message settings-error-message">
        {loadError ?? 'Could not load the Room Loader configuration.'}
        <button type="button" className="btn secondary btn-sm" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  const { outdoor, medicalConcern, membership, chronicMeds, labsPage, productGuide } = config;
  const membershipAgeNote = membershipPlanAgeDisagreement(alignPlans);

  return (
    <SpeciesCatalogContext.Provider value={speciesCatalog}>
    <div className="rl-cfg">
      <Section
        title="Lab panels by age & species"
        description={`${membershipCutoffHint()} A pet can match several rules; the lowest order asks first. Medical-concern overwrite is under Medical concern below.`}
        meta={`${config.panelRules.length} rule${config.panelRules.length === 1 ? '' : 's'}`}
        defaultOpen
      >
        {membershipAgeNote ? <p className="rl-cfg__warn">{membershipAgeNote}</p> : null}
        {config.panelRules.length === 0 ? (
          <p className="rl-cfg__empty">No panel rules yet.</p>
        ) : null}
        {config.panelRules.map((rule, index) => (
          <PanelRuleEditor
            key={rule.id}
            practiceId={practiceId}
            rule={rule}
            allRules={config.panelRules}
            labsPage={labsPage}
            overwriteAgeBasedPanels={medicalConcern.overwriteAgeBasedPanels !== false}
            index={index}
            total={config.panelRules.length}
            plans={alignPlans}
            onChange={(patch) =>
              setPanelRules((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)))
            }
            onMove={(delta) => setPanelRules((list) => resequence(moveAt(list, index, delta)))}
            onRemove={() => setPanelRules((list) => list.filter((_, i) => i !== index))}
            onError={onError}
          />
        ))}
        <AddButton
          label="Add a panel rule"
          onClick={() => setPanelRules((list) => [...list, newPanelRule(list.length)])}
        />
      </Section>

      <Section
        title="Offer to everyone"
        description="Add-ons shown to every patient the species filter allows, whatever their age or history."
        meta={`${config.universalOffers.length} offer${config.universalOffers.length === 1 ? '' : 's'}`}
      >
        {config.universalOffers.length === 0 ? (
          <p className="rl-cfg__empty">No universal offers yet.</p>
        ) : null}
        {config.universalOffers.map((offer, index) => (
          <UniversalOfferEditor
            key={offer.id}
            practiceId={practiceId}
            offer={offer}
            index={index}
            total={config.universalOffers.length}
            onChange={(patch) =>
              setUniversalOffers((list) =>
                list.map((o, i) => (i === index ? { ...o, ...patch } : o))
              )
            }
            onMove={(delta) => setUniversalOffers((list) => resequence(moveAt(list, index, delta)))}
            onRemove={() => setUniversalOffers((list) => list.filter((_, i) => i !== index))}
          />
        ))}
        <AddButton
          label="Add an offer"
          onClick={() => setUniversalOffers((list) => [...list, newUniversalOffer(list.length)])}
        />
      </Section>

      <Section
        title="Species & age gated offers"
        description="One item offered only to the pets that fit the species, age and history rules below."
        meta={`${config.gatedOffers.length} offer${config.gatedOffers.length === 1 ? '' : 's'}`}
      >
        {config.gatedOffers.length === 0 ? (
          <p className="rl-cfg__empty">No gated offers yet.</p>
        ) : null}
        {config.gatedOffers.map((offer, index) => (
          <GatedOfferEditor
            key={offer.id}
            practiceId={practiceId}
            offer={offer}
            index={index}
            total={config.gatedOffers.length}
            onChange={(patch) =>
              setGatedOffers((list) => list.map((o, i) => (i === index ? { ...o, ...patch } : o)))
            }
            onMove={(delta) => setGatedOffers((list) => resequence(moveAt(list, index, delta)))}
            onRemove={() => setGatedOffers((list) => list.filter((_, i) => i !== index))}
          />
        ))}
        <div className="rl-cfg__row-actions-inline">
          <AddButton
            label="Add a gated offer"
            onClick={() => setGatedOffers((list) => [...list, newGatedOffer(list.length)])}
          />
          <AddButton
            label="Add VAYD starter vaccines"
            onClick={() =>
              setGatedOffers((list) => resequence([...list, ...missingById(list, vaydVaccineGatedOffers())]))
            }
          />
        </div>
      </Section>

      <Section
        title="Questions about the estimate"
        description="Asked because of a line staff already put on the estimate — which form of a vaccine the owner wants, whether to book the booster after a first dose. The answer goes to staff and the PDF; it does not change the estimate."
        meta={`${(config.itemQuestions ?? []).length} question${
          (config.itemQuestions ?? []).length === 1 ? '' : 's'
        }`}
      >
        {(config.itemQuestions ?? []).length === 0 ? (
          <p className="rl-cfg__empty">No questions yet.</p>
        ) : null}
        {(config.itemQuestions ?? []).map((question, index) => (
          <ItemQuestionEditor
            key={question.id}
            practiceId={practiceId}
            question={question}
            index={index}
            total={(config.itemQuestions ?? []).length}
            onChange={(patch) =>
              setItemQuestions((list) => list.map((q, i) => (i === index ? { ...q, ...patch } : q)))
            }
            onMove={(delta) => setItemQuestions((list) => resequence(moveAt(list, index, delta)))}
            onRemove={() => setItemQuestions((list) => list.filter((_, i) => i !== index))}
          />
        ))}
        <div className="rl-cfg__row-actions-inline">
          <AddButton
            label="Add a question"
            onClick={() => setItemQuestions((list) => [...list, newItemQuestion(list.length)])}
          />
          <AddButton
            label="Add VAYD starter questions"
            onClick={() =>
              setItemQuestions((list) => resequence([...list, ...missingById(list, vaydItemQuestions())]))
            }
          />
        </div>
      </Section>

      <Section
        title="Why we recommend this"
        description="Shown under a care plan or summary line once the client unchecks it. Use it for vaccines and screenings staff put on the estimate, such as rabies or FVRCP."
        meta={`${(config.declineReasons ?? []).length} explanation${
          (config.declineReasons ?? []).length === 1 ? '' : 's'
        }`}
      >
        {(config.declineReasons ?? []).length === 0 ? (
          <p className="rl-cfg__empty">
            No explanations yet. Rows fall back to the built-in vaccine and screening copy.
          </p>
        ) : null}
        {(config.declineReasons ?? []).map((reason, index) => (
          <DeclineReasonEditor
            key={reason.id}
            practiceId={practiceId}
            reason={reason}
            index={index}
            total={(config.declineReasons ?? []).length}
            onChange={(patch) =>
              setDeclineReasons((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)))
            }
            onMove={(delta) => setDeclineReasons((list) => moveAt(list, index, delta))}
            onRemove={() => setDeclineReasons((list) => list.filter((_, i) => i !== index))}
          />
        ))}
        <div className="rl-cfg__row-actions-inline">
          <AddButton
            label="Add an explanation"
            onClick={() => setDeclineReasons((list) => [...list, newDeclineReason()])}
          />
          <AddButton
            label="Add VAYD starter explanations"
            onClick={() =>
              setDeclineReasons((list) => [...list, ...missingById(list, vaydDeclineReasons())])
            }
          />
        </div>
      </Section>

      <Section
        title="Outdoor question"
        description="Asked once per pet. Sub-asks and gated offers can wait on a yes."
      >
        <CheckField
          label="Ask the outdoor-access question"
          checked={outdoor.enabled}
          onChange={(enabled) => patchOutdoor({ enabled })}
        />
        <div className="rl-cfg__grid">
          <SpeciesFilterField
            label="Ask for"
            value={outdoor.species}
            onChange={(species) => patchOutdoor({ species })}
          />
          <CheckField
            label="An answer is required"
            checked={outdoor.required}
            onChange={(required) => patchOutdoor({ required })}
          />
        </div>
        <TextField
          label="Question"
          wide
          value={outdoor.questionText}
          hint={PET_NAME_HINT}
          onChange={(questionText) => patchOutdoor({ questionText })}
        />
        <HtmlField
          label="Shown after a yes"
          value={outdoor.pitchHtml}
          placeholder="Why outdoor pets need this…"
          hint={PET_NAME_HINT}
          onChange={(pitchHtml) => patchOutdoor({ pitchHtml })}
        />
        <div className="rl-cfg__grid">
          <ItemField
            label="Item offered after a yes"
            practiceId={practiceId}
            value={outdoor.pitchItem}
            onChange={(pitchItem) => patchOutdoor({ pitchItem })}
          />
          <TextField
            label="Name the client sees"
            value={outdoor.pitchDisplayName}
            placeholder={itemLabel(outdoor.pitchItem)}
            onChange={(pitchDisplayName) => patchOutdoor({ pitchDisplayName })}
          />
        </div>
        <HtmlField
          label="Shown if they cross it out"
          value={outdoor.pitchCautionHtml}
          onChange={(pitchCautionHtml) => patchOutdoor({ pitchCautionHtml })}
        />
        <HistoryGateEditor
          value={outdoor.history}
          onChange={(history) => patchOutdoor({ history })}
        />
      </Section>

      <Section
        title="Medical concern"
        description="What happens when staff flag that the visit warrants lab work."
      >
        <CheckField
          label="Replace the usual panel with this species’ two-panel choice"
          checked={medicalConcern.overwriteAgeBasedPanels !== false}
          hint="A sick puppy or adult sees Standard vs Extended at any age, not fecal-only or early detection. Uses the two-panel rule for that species. Turn off to keep the age-based ask and only add the extra panels below."
          onChange={(overwriteAgeBasedPanels) =>
            patchMedicalConcern({ overwriteAgeBasedPanels })
          }
        />
        <CheckField
          label="Also ask about these extra panels"
          checked={medicalConcern.enabled}
          hint="Adds the panels below on top of whatever rule the client is already seeing."
          onChange={(enabled) => patchMedicalConcern({ enabled })}
        />
        <SpeciesFilterField
          label="Ask for"
          value={medicalConcern.species}
          onChange={(species) => patchMedicalConcern({ species })}
        />
        <HtmlField
          label="Shown above the panels"
          value={medicalConcern.introHtml}
          onChange={(introHtml) => patchMedicalConcern({ introHtml })}
        />
        <PanelOptionList
          practiceId={practiceId}
          options={medicalConcern.options}
          species={medicalConcern.species}
          plans={alignPlans}
          onChange={(options) => patchMedicalConcern({ options })}
          onError={onError}
        />
      </Section>

      <Section title="Labs page copy" description="Headings the client reads above the panels.">
        <TextField
          label="Page title"
          wide
          value={labsPage.title}
          onChange={(title) => patchLabsPage({ title })}
        />
        <HtmlField
          label="Intro"
          value={labsPage.introHtml}
          onChange={(introHtml) => patchLabsPage({ introHtml })}
        />
        <HtmlField
          label="Intro when a medical concern was flagged"
          value={labsPage.medicalConcernIntroHtml}
          onChange={(medicalConcernIntroHtml) => patchLabsPage({ medicalConcernIntroHtml })}
        />
        <ImageField
          label="Sample results image"
          imageUrl={labsPage.imageUrl}
          imageCaption={labsPage.imageCaption}
          onChange={patchLabsPage}
          onError={onError}
        />
      </Section>

      <Section
        title="How to collect a sample"
        description="Shown at the bottom of the labs page once the client accepts a test that needs the owner to collect something. List the panels that bundle a stool or urine test — a panel you leave off every card says nothing."
        meta={`${(config.sampleInstructions ?? []).length} instruction${
          (config.sampleInstructions ?? []).length === 1 ? '' : 's'
        }`}
      >
        {(config.sampleInstructions ?? []).length === 0 ? (
          <p className="rl-cfg__empty">No collection instructions yet.</p>
        ) : null}
        {(config.sampleInstructions ?? []).map((instruction, index) => (
          <SampleInstructionEditor
            key={instruction.id}
            practiceId={practiceId}
            instruction={instruction}
            index={index}
            total={(config.sampleInstructions ?? []).length}
            onChange={(patch) =>
              setSampleInstructions((list) =>
                list.map((row, i) => (i === index ? { ...row, ...patch } : row))
              )
            }
            onMove={(delta) =>
              setSampleInstructions((list) => resequence(moveAt(list, index, delta)))
            }
            onRemove={() => setSampleInstructions((list) => list.filter((_, i) => i !== index))}
          />
        ))}
        <div className="rl-cfg__row-actions-inline">
          <AddButton
            label="Add collection instructions"
            onClick={() =>
              setSampleInstructions((list) => [...list, newSampleInstruction(list.length)])
            }
          />
          <AddButton
            label="Add VAYD starter instructions"
            onClick={() =>
              setSampleInstructions((list) =>
                resequence([...list, ...missingById(list, vaydSampleInstructions())])
              )
            }
          />
        </div>
      </Section>

      <Section
        title="Prevention guide"
        description="A collapsible comparison table on the summary page. Informational only — nothing here is added to the estimate; it tells the client what to search for in the store box."
        meta={
          productGuide.enabled
            ? `${productGuide.tables.length} table${productGuide.tables.length === 1 ? '' : 's'}`
            : 'Off'
        }
      >
        <CheckField
          label="Show the prevention guide"
          checked={productGuide.enabled}
          onChange={(enabled) => patchProductGuide({ enabled })}
        />
        <TextField
          label="Text on the expander"
          wide
          placeholder="Learn more about the prevention we offer"
          value={productGuide.summaryLabel}
          onChange={(summaryLabel) => patchProductGuide({ summaryLabel })}
        />
        {productGuide.tables.length === 0 ? <p className="rl-cfg__empty">No tables yet.</p> : null}
        {productGuide.tables.map((table, index) => (
          <ProductGuideTableEditor
            key={table.id}
            table={table}
            index={index}
            total={productGuide.tables.length}
            onChange={(patch) =>
              patchProductGuide({
                tables: productGuide.tables.map((t, i) => (i === index ? { ...t, ...patch } : t)),
              })
            }
            onMove={(delta) =>
              patchProductGuide({ tables: resequence(moveAt(productGuide.tables, index, delta)) })
            }
            onRemove={() =>
              patchProductGuide({
                tables: resequence(productGuide.tables.filter((_, i) => i !== index)),
              })
            }
          />
        ))}
        <AddButton
          label="Add a table"
          onClick={() =>
            patchProductGuide({
              tables: [...productGuide.tables, newProductGuideTable(productGuide.tables.length)],
            })
          }
        />
      </Section>

      <Section
        title="Membership pitch"
        description="The savings comparison shown on the summary page."
      >
        <CheckField
          label="Show the membership pitch"
          checked={membership.enabled}
          onChange={(enabled) => patchMembership({ enabled })}
        />
        <div className="rl-cfg__grid">
          <SelectField
            label="Where it sits"
            value={membership.placement}
            options={PLACEMENT_OPTIONS}
            onChange={(placement) => patchMembership({ placement })}
          />
          <NumberField
            label="Savings rows shown before expanding"
            value={membership.previewRowCount}
            hint="0 shows the headline only."
            onChange={(n) => patchMembership({ previewRowCount: n ?? 0 })}
          />
        </div>
        <CheckField
          label="Open the comparison straight away"
          checked={membership.startExpanded}
          onChange={(startExpanded) => patchMembership({ startExpanded })}
        />
        <TextField
          label="Headline"
          wide
          value={membership.headline}
          onChange={(headline) => patchMembership({ headline })}
        />
        <HtmlField
          label="Subhead"
          value={membership.subheadHtml}
          onChange={(subheadHtml) => patchMembership({ subheadHtml })}
        />
        <div className="rl-cfg__grid">
          <TextField
            label="Expand button"
            value={membership.expandLabel}
            onChange={(expandLabel) => patchMembership({ expandLabel })}
          />
          <TextField
            label="Collapse button"
            value={membership.collapseLabel}
            onChange={(collapseLabel) => patchMembership({ collapseLabel })}
          />
        </div>
      </Section>

      <Section
        title="Chronic medication refills"
        description="Replaces the pre-exam medication question with a refill ask."
      >
        <CheckField
          label="Ask about refills"
          checked={chronicMeds.enabled}
          onChange={(enabled) => patchChronicMeds({ enabled })}
        />
        <TextField
          label="Question"
          wide
          value={chronicMeds.questionText}
          hint={PET_NAME_HINT}
          onChange={(questionText) => patchChronicMeds({ questionText })}
        />
        <HtmlField
          label="Intro"
          value={chronicMeds.introHtml}
          onChange={(introHtml) => patchChronicMeds({ introHtml })}
        />
        <div className="rl-cfg__grid">
          <CheckField
            label="Offer “bring it to the visit”"
            checked={chronicMeds.allowBring}
            onChange={(allowBring) => patchChronicMeds({ allowBring })}
          />
          <TextField
            label="Bring-it label"
            value={chronicMeds.bringLabel}
            onChange={(bringLabel) => patchChronicMeds({ bringLabel })}
          />
          <CheckField
            label="Offer “ship it to me”"
            checked={chronicMeds.allowShip}
            onChange={(allowShip) => patchChronicMeds({ allowShip })}
          />
          <TextField
            label="Ship-it label"
            value={chronicMeds.shipLabel}
            onChange={(shipLabel) => patchChronicMeds({ shipLabel })}
          />
          <CheckField
            label="Let them type a medication we have no record of"
            checked={chronicMeds.allowFreeText}
            onChange={(allowFreeText) => patchChronicMeds({ allowFreeText })}
          />
          <TextField
            label="Free-text label"
            value={chronicMeds.freeTextLabel}
            onChange={(freeTextLabel) => patchChronicMeds({ freeTextLabel })}
          />
        </div>
      </Section>

      <Section
        title="Default caution text"
        description="Used whenever an offer has no caution of its own to show after the client crosses it out."
      >
        <HtmlField
          label="Caution"
          value={config.defaultDeclineCautionHtml}
          onChange={(defaultDeclineCautionHtml) =>
            setConfig((prev) => (prev ? { ...prev, defaultDeclineCautionHtml } : prev))
          }
        />
      </Section>

      <div className="settings-action-bar rl-cfg__actions">
        <button className="btn" type="button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save Room Loader settings'}
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => void load()}
          disabled={saving || !dirty}
        >
          Discard changes
        </button>
        <button className="btn secondary" type="button" onClick={() => void loadStarter()} disabled={saving}>
          Load VAYD starter settings
        </button>
        <span className={`rl-cfg__dirty${dirty ? ' is-dirty' : ''}`}>
          {dirty ? 'Unsaved changes' : 'All changes saved'}
        </span>
      </div>
    </div>
    </SpeciesCatalogContext.Provider>
  );
}

export default function SettingsRoomLoader(props: Props) {
  return (
    <RoomLoaderPaneBoundary>
      <SettingsRoomLoaderEditor {...props} />
    </RoomLoaderPaneBoundary>
  );
}

/* ---------------------------------------------------------------- layout */

function Section({
  title,
  description,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rl-cfg__section">
      <button
        type="button"
        className="rl-cfg__section-head"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        <span className="rl-cfg__section-title">{title}</span>
        {meta ? <span className="rl-cfg__section-meta">{meta}</span> : null}
      </button>
      {open ? (
        <div className="rl-cfg__section-body">
          {description ? <p className="rl-cfg__note">{description}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="rl-cfg__add" onClick={onClick}>
      <Plus size={14} aria-hidden /> {label}
    </button>
  );
}

function RowActions({
  label,
  index,
  total,
  onMove,
  onRemove,
}: {
  label: string;
  index: number;
  total: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rl-cfg__row-actions">
      <button
        type="button"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ChevronUp size={15} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        disabled={index === total - 1}
        onClick={() => onMove(1)}
      >
        <ChevronDown size={15} aria-hidden />
      </button>
      <button
        type="button"
        className="rl-cfg__danger"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}

function EnabledSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="rl-cfg__switch">
      <input
        type="checkbox"
        aria-label="Enabled"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="rl-cfg__switch-track" aria-hidden="true" />
    </label>
  );
}

function ProductGuideTableEditor({
  table,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  table: RoomLoaderProductGuideTable;
  index: number;
  total: number;
  onChange: (patch: Partial<RoomLoaderProductGuideTable>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const setRows = (fn: (rows: RoomLoaderProductGuideRow[]) => RoomLoaderProductGuideRow[]) =>
    onChange({ rows: fn(table.rows) });

  return (
    <div className="rl-cfg__card">
      <div className="rl-cfg__card-head">
        <strong>{table.heading || 'Untitled table'}</strong>
        <RowActions label="table" index={index} total={total} onMove={onMove} onRemove={onRemove} />
      </div>
      <div className="rl-cfg__grid">
        <SpeciesFilterField
          label="Shown to owners of"
          value={table.species}
          onChange={(species) => onChange({ species })}
        />
        <TextField
          label="Heading"
          value={table.heading}
          placeholder="Recommended parasite prevention for dogs"
          onChange={(heading) => onChange({ heading })}
        />
      </div>
      <HtmlField
        label="Note above the table"
        value={table.noteHtml}
        onChange={(noteHtml) => onChange({ noteHtml })}
      />
      {table.rows.map((row, rowIndex) => (
        <div className="rl-cfg__card rl-cfg__card--nested" key={row.id}>
          <div className="rl-cfg__card-head">
            <span>{row.approach || `Row ${rowIndex + 1}`}</span>
            <RowActions
              label="row"
              index={rowIndex}
              total={table.rows.length}
              onMove={(delta) => setRows((rows) => moveAt(rows, rowIndex, delta))}
              onRemove={() => setRows((rows) => rows.filter((_, i) => i !== rowIndex))}
            />
          </div>
          <div className="rl-cfg__grid">
            <TextField
              label="Approach"
              value={row.approach}
              placeholder="One and Done"
              onChange={(approach) =>
                setRows((rows) => rows.map((r, i) => (i === rowIndex ? { ...r, approach } : r)))
              }
            />
            <TextField
              label="Medication"
              value={row.medication}
              placeholder="Credelio Quattro"
              onChange={(medication) =>
                setRows((rows) => rows.map((r, i) => (i === rowIndex ? { ...r, medication } : r)))
              }
            />
            <TextField
              label="Schedule"
              value={row.schedule}
              placeholder="Monthly chew"
              onChange={(schedule) =>
                setRows((rows) => rows.map((r, i) => (i === rowIndex ? { ...r, schedule } : r)))
              }
            />
          </div>
          <HtmlField
            label="Covers"
            value={row.coversHtml}
            onChange={(coversHtml) =>
              setRows((rows) => rows.map((r, i) => (i === rowIndex ? { ...r, coversHtml } : r)))
            }
          />
        </div>
      ))}
      <AddButton
        label="Add a row"
        onClick={() => setRows((rows) => [...rows, newProductGuideRow()])}
      />
      <HtmlField
        label="Note below the table"
        value={table.footerHtml}
        onChange={(footerHtml) => onChange({ footerHtml })}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- fields */

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  wide,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={`rl-cfg__field${wide ? ' rl-cfg__field--wide' : ''}`}>
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <em>{hint}</em> : null}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  hint,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label className="rl-cfg__field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        value={value == null ? '' : String(value)}
        placeholder={placeholder}
        onChange={(e) => onChange(numOrNull(e.target.value))}
      />
      {hint ? <em>{hint}</em> : null}
    </label>
  );
}

function SpeciesFilterField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: unknown;
  onChange: (next: RoomLoaderSpeciesSelection) => void;
  hint?: string;
}) {
  const catalog = useEditorSpeciesCatalog();
  const options = speciesOptionsForEditor(catalog, value);
  const selection = asSpeciesSelection(value);
  const allSelected = speciesSelectionIsAll(selection);

  function toggleAll() {
    onChange([ROOM_LOADER_ALL_SPECIES]);
  }

  function toggleSlug(slug: string) {
    if (allSelected) {
      onChange([slug]);
      return;
    }
    const next = selection.includes(slug)
      ? selection.filter((item) => item !== slug)
      : [...selection, slug];
    onChange(next.length === 0 ? [ROOM_LOADER_ALL_SPECIES] : next);
  }

  return (
    <fieldset className="rl-cfg__field rl-cfg__field--wide rl-cfg__species">
      <legend>{label}</legend>
      <div className="rl-cfg__species-list" role="group" aria-label={label}>
        <label className="rl-cfg__species-option">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          <span>All species</span>
        </label>
        {options.map((row) => {
          const slug = speciesSlug(row.prettyName || row.name);
          return (
            <label key={`${row.id ?? slug}:${slug}`} className="rl-cfg__species-option">
              <input
                type="checkbox"
                checked={!allSelected && selection.includes(slug)}
                onChange={() => toggleSlug(slug)}
              />
              <span>{row.prettyName || row.name}</span>
            </label>
          );
        })}
      </div>
      <em>
        {hint ??
          'Pick All, or any combination. Dogs and cats are listed first from the practice species catalog.'}
      </em>
    </fieldset>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  hint?: string;
}) {
  return (
    <label className="rl-cfg__field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <em>{hint}</em> : null}
    </label>
  );
}

function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="rl-cfg__check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        {hint ? <em>{hint}</em> : null}
      </span>
    </label>
  );
}

function HtmlField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="rl-cfg__field rl-cfg__field--wide">
      <span>{label}</span>
      <MessageTemplateHtmlEditor
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? 'Write what the client should read.'}
        allowInlineImages={false}
      />
      {hint ? <em>{hint}</em> : null}
    </div>
  );
}

function ItemField({
  label,
  practiceId,
  value,
  onChange,
  hint,
  placeholder,
}: {
  label: string;
  practiceId: number;
  value: RoomLoaderItemRef | null;
  onChange: (next: RoomLoaderItemRef | null) => void;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <div className="rl-cfg__field">
      <span>{label}</span>
      <CatalogItemPicker
        practiceId={practiceId}
        value={toPicked(value)}
        placeholder={placeholder ?? 'Search products, labs, procedures…'}
        onChange={(picked) => onChange(fromPicked(picked))}
      />
      {hint ? <em>{hint}</em> : null}
    </div>
  );
}

function ItemRefList({
  practiceId,
  title,
  note,
  items,
  onChange,
  addLabel,
}: {
  practiceId: number;
  title: string;
  note: string;
  items: RoomLoaderItemRef[];
  onChange: (next: RoomLoaderItemRef[]) => void;
  addLabel: string;
}) {
  return (
    <div className="rl-cfg__sub">
      <div className="rl-cfg__sub-head">
        <h4 className="rl-cfg__sub-title">{title}</h4>
        <AddButton label={addLabel} onClick={() => onChange([...items, emptyItemRef()])} />
      </div>
      <p className="rl-cfg__note">{note}</p>
      {items.map((item, index) => (
        <div className="rl-cfg__item-row" key={`${item.itemType}-${item.itemId}-${index}`}>
          <CatalogItemPicker
            practiceId={practiceId}
            value={toPicked(item)}
            placeholder="Search products, labs, procedures…"
            onChange={(picked) => {
              const next = fromPicked(picked);
              onChange(
                next == null
                  ? items.filter((_, i) => i !== index)
                  : items.map((row, i) => (i === index ? next : row))
              );
            }}
          />
          <button
            type="button"
            className="rl-cfg__danger"
            aria-label="Remove this item"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

function AgeWindowField({
  species,
  age,
  onChange,
}: {
  species: RoomLoaderSpecies | RoomLoaderSpeciesSelection;
  age: RoomLoaderAgeWindow;
  onChange: (next: RoomLoaderAgeWindow) => void;
}) {
  const catalog = useEditorSpeciesCatalog();
  const [unit, setUnit] = useState<AgeUnit>(() => inferAgeUnit(age));
  const [minText, setMinText] = useState(() => ageInputText(age.minMonths, inferAgeUnit(age)));
  const [maxText, setMaxText] = useState(() => ageInputText(age.maxMonths, inferAgeUnit(age)));

  useEffect(() => {
    const nextUnit = inferAgeUnit(age);
    setUnit(nextUnit);
    setMinText(ageInputText(age.minMonths, nextUnit));
    setMaxText(ageInputText(age.maxMonths, nextUnit));
  }, [age.minMonths, age.maxMonths]);

  function commit(nextMin: string, nextMax: string, nextUnit: AgeUnit) {
    const factor = nextUnit === 'years' ? 12 : 1;
    const min = numOrNull(nextMin);
    const max = numOrNull(nextMax);
    onChange({
      minMonths: min == null ? 0 : Math.max(0, Math.round(min * factor)),
      maxMonths: max == null ? null : Math.max(0, Math.round(max * factor)),
    });
  }

  return (
    <div className="rl-cfg__field rl-cfg__field--wide">
      <span>Age window</span>
      <div className="rl-cfg__age">
        <input
          type="number"
          min={0}
          aria-label="Youngest age"
          placeholder="0"
          value={minText}
          onChange={(e) => {
            setMinText(e.target.value);
            commit(e.target.value, maxText, unit);
          }}
        />
        <span>up to</span>
        <input
          type="number"
          min={0}
          aria-label="Oldest age"
          placeholder="no limit"
          value={maxText}
          onChange={(e) => {
            setMaxText(e.target.value);
            commit(minText, e.target.value, unit);
          }}
        />
        <select
          aria-label="Age unit"
          value={unit}
          onChange={(e) => {
            const next = e.target.value as AgeUnit;
            setUnit(next);
            commit(minText, maxText, next);
          }}
        >
          <option value="months">months</option>
          <option value="years">years</option>
        </select>
      </div>
      <em>{describeAgeWindow(species, age, catalog)}</em>
    </div>
  );
}

function HistoryGateEditor({
  value,
  onChange,
}: {
  value: RoomLoaderHistoryGate;
  onChange: (next: RoomLoaderHistoryGate) => void;
}) {
  const patch = (next: Partial<RoomLoaderHistoryGate>) => onChange({ ...value, ...next });
  return (
    <fieldset className="rl-cfg__gate">
      <legend>When not to ask</legend>
      <div className="rl-cfg__grid">
        <NumberField
          label="Don’t offer if given in the last ___ months"
          value={value.suppressIfDoneWithinMonths}
          hint="Leave blank to offer no matter how recently it was done."
          placeholder="always offer"
          onChange={(suppressIfDoneWithinMonths) => patch({ suppressIfDoneWithinMonths })}
        />
        <NumberField
          label="Don’t offer if a reminder is due more than ___ months out"
          value={value.suppressIfReminderDueBeyondMonths}
          hint="Leave blank to ignore reminders."
          placeholder="ignore reminders"
          onChange={(suppressIfReminderDueBeyondMonths) =>
            patch({ suppressIfReminderDueBeyondMonths })
          }
        />
      </div>
      <CheckField
        label="Offer anyway if the client declined it before"
        checked={value.showEvenIfPreviouslyDeclined}
        onChange={(showEvenIfPreviouslyDeclined) => patch({ showEvenIfPreviouslyDeclined })}
      />
      {value.showEvenIfPreviouslyDeclined ? (
        <NumberField
          label="Wait ___ months after a decline before asking again"
          value={value.reofferDeclinedAfterMonths}
          hint="Leave blank to ask at the very next visit."
          placeholder="next visit"
          onChange={(reofferDeclinedAfterMonths) => patch({ reofferDeclinedAfterMonths })}
        />
      ) : null}
    </fieldset>
  );
}

function appMainScrollElement(): HTMLElement | null {
  return document.querySelector('main.container');
}

function ImageField({
  label,
  imageUrl,
  imageCaption,
  onChange,
  onError,
}: {
  label: string;
  imageUrl: string | null;
  imageCaption: string;
  onChange: (patch: { imageUrl?: string | null; imageCaption?: string }) => void;
  onError: (msg: string) => void;
}) {
  const restoreScrollTopRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const top = restoreScrollTopRef.current;
    if (top == null) return;
    restoreScrollTopRef.current = null;
    const scroller = appMainScrollElement();
    if (scroller) scroller.scrollTop = top;
    else window.scrollTo(0, top);
  }, [imageUrl]);

  return (
    <div className="rl-cfg__field rl-cfg__field--wide">
      <span>{label}</span>
      <div className="rl-cfg__image">
        {imageUrl ? (
          <img
            className="rl-cfg__image-preview"
            src={imageUrl}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <span className="rl-cfg__image-empty">No image</span>
        )}
        <div className="rl-cfg__image-controls">
          <label className="settings-file-label">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="settings-file-input"
              onChange={(e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                input.value = '';
                input.blur();
                if (!file) return;
                const scroller = appMainScrollElement();
                const scrollTop = scroller?.scrollTop ?? window.scrollY;
                void fileToEmbeddedImageDataUrl(file)
                  .then((dataUrl) => {
                    try {
                      restoreScrollTopRef.current = scrollTop;
                      onChange({ imageUrl: dataUrl });
                    } catch (err: unknown) {
                      onError(extractErr(err));
                    }
                  })
                  .catch((err: unknown) => onError(extractErr(err)));
              }}
            />
            <span className="btn secondary btn-sm">{imageUrl ? 'Replace image' : 'Add image'}</span>
          </label>
          {imageUrl ? (
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => onChange({ imageUrl: null })}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      <input
        type="text"
        className="rl-cfg__caption"
        aria-label={`${label} caption`}
        placeholder="Caption shown under the image"
        value={imageCaption}
        onChange={(e) => onChange({ imageCaption: e.target.value })}
      />
      <em>PNG or JPEG. Large screenshots are shrunk so they do not lock this page.</em>
    </div>
  );
}

/* --------------------------------------------------------------- editors */

function PanelOptionList({
  practiceId,
  options,
  species,
  plans,
  onChange,
  onError,
}: {
  practiceId: number;
  options: RoomLoaderPanelOption[];
  species: RoomLoaderSpecies | RoomLoaderSpeciesSelection;
  plans: MembershipAlignPlan[];
  onChange: (next: RoomLoaderPanelOption[]) => void;
  onError: (msg: string) => void;
}) {
  return (
    <div className="rl-cfg__sub">
      <div className="rl-cfg__sub-head">
        <h4 className="rl-cfg__sub-title">Panels the client can accept</h4>
        <AddButton label="Add a panel" onClick={() => onChange([...options, newPanelOption()])} />
      </div>
      {options.length === 0 ? <p className="rl-cfg__empty">No panels yet.</p> : null}
      {options.length > 1 ? (
        <p className="rl-cfg__hint">The client is asked to choose one of these.</p>
      ) : null}
      {options.map((option, index) => (
        <PanelOptionEditor
          key={option.id}
          practiceId={practiceId}
          option={option}
          index={index}
          total={options.length}
          species={species}
          plans={plans}
          onChange={(patch) =>
            onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)))
          }
          onMove={(delta) => onChange(moveAt(options, index, delta))}
          onRemove={() => onChange(options.filter((_, i) => i !== index))}
          onError={onError}
        />
      ))}
    </div>
  );
}

function PanelOptionEditor({
  practiceId,
  option,
  index,
  total,
  species,
  plans,
  onChange,
  onMove,
  onRemove,
  onError,
}: {
  practiceId: number;
  option: RoomLoaderPanelOption;
  index: number;
  total: number;
  species: RoomLoaderSpecies | RoomLoaderSpeciesSelection;
  plans: MembershipAlignPlan[];
  onChange: (patch: Partial<RoomLoaderPanelOption>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onError: (msg: string) => void;
}) {
  const name = option.displayName || itemLabel(option.item) || 'New panel';
  const coveredBy = coveringPlansLabel(
    coveringFamiliesForItem(option.item, plans, species),
    name
  );
  return (
    <div className="rl-cfg__card rl-cfg__card--nested">
      <header className="rl-cfg__card-head">
        <span className="rl-cfg__card-title">{name}</span>
        <RowActions label={name} index={index} total={total} onMove={onMove} onRemove={onRemove} />
      </header>
      <div className="rl-cfg__card-body">
        <div className="rl-cfg__grid">
          <ItemField
            label="Catalog item"
            practiceId={practiceId}
            value={option.item}
            onChange={(next) => onChange({ item: next ?? emptyItemRef() })}
          />
          <TextField
            label="Name the client sees"
            value={option.displayName}
            placeholder={itemLabel(option.item)}
            onChange={(displayName) => onChange({ displayName })}
          />
        </div>
        {coveredBy ? <p className="rl-cfg__hint">{coveredBy}</p> : null}
        <HtmlField
          label="Description"
          value={option.descriptionHtml}
          onChange={(descriptionHtml) => onChange({ descriptionHtml })}
        />
        <ImageField
          label="Sample results image"
          imageUrl={option.imageUrl}
          imageCaption={option.imageCaption}
          onChange={onChange}
          onError={onError}
        />
        <ItemRefList
          practiceId={practiceId}
          title="Comes off the estimate"
          note="Items pulled off the staff estimate when the client accepts this panel."
          items={option.replacesItems}
          addLabel="Add an item"
          onChange={(replacesItems) => onChange({ replacesItems })}
        />
        <div className="rl-cfg__sub">
          <div className="rl-cfg__sub-head">
            <h4 className="rl-cfg__sub-title">Offer individually if this panel is crossed out</h4>
            <AddButton
              label="Add a follow-up ask"
              onClick={() => onChange({ subAsks: [...option.subAsks, newSubAsk()] })}
            />
          </div>
          {option.subAsks.length === 0 ? (
            <p className="rl-cfg__empty">Nothing is offered separately.</p>
          ) : null}
          {option.subAsks.map((subAsk, i) => (
            <SubAskEditor
              key={subAsk.id}
              practiceId={practiceId}
              subAsk={subAsk}
              index={i}
              total={option.subAsks.length}
              onChange={(patch) =>
                onChange({
                  subAsks: option.subAsks.map((s, j) => (j === i ? { ...s, ...patch } : s)),
                })
              }
              onMove={(delta) => onChange({ subAsks: moveAt(option.subAsks, i, delta) })}
              onRemove={() => onChange({ subAsks: option.subAsks.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SubAskEditor({
  practiceId,
  subAsk,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  practiceId: number;
  subAsk: RoomLoaderPanelSubAsk;
  index: number;
  total: number;
  onChange: (patch: Partial<RoomLoaderPanelSubAsk>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const name = subAsk.displayName || itemLabel(subAsk.item) || 'New follow-up ask';
  return (
    <div className="rl-cfg__card rl-cfg__card--nested">
      <header className="rl-cfg__card-head">
        <span className="rl-cfg__card-title">{name}</span>
        <RowActions label={name} index={index} total={total} onMove={onMove} onRemove={onRemove} />
      </header>
      <div className="rl-cfg__card-body">
        <div className="rl-cfg__grid">
          <ItemField
            label="Catalog item"
            practiceId={practiceId}
            value={subAsk.item}
            onChange={(next) => onChange({ item: next ?? emptyItemRef() })}
          />
          <TextField
            label="Name the client sees"
            value={subAsk.displayName}
            placeholder={itemLabel(subAsk.item)}
            onChange={(displayName) => onChange({ displayName })}
          />
        </div>
        <HtmlField
          label="Why we recommend it"
          value={subAsk.cautionHtml}
          onChange={(cautionHtml) => onChange({ cautionHtml })}
        />
        <CheckField
          label="Only ask when the owner says the pet goes outdoors"
          checked={subAsk.requiresOutdoorAccess}
          onChange={(requiresOutdoorAccess) => onChange({ requiresOutdoorAccess })}
        />
        <HistoryGateEditor value={subAsk.history} onChange={(history) => onChange({ history })} />
      </div>
    </div>
  );
}

function PanelRuleEditor({
  practiceId,
  rule,
  allRules,
  labsPage,
  overwriteAgeBasedPanels,
  index,
  total,
  plans,
  onChange,
  onMove,
  onRemove,
  onError,
}: {
  practiceId: number;
  rule: RoomLoaderPanelRule;
  allRules: RoomLoaderPanelRule[];
  labsPage: RoomLoaderLabsPageConfig;
  overwriteAgeBasedPanels: boolean;
  index: number;
  total: number;
  plans: MembershipAlignPlan[];
  onChange: (patch: Partial<RoomLoaderPanelRule>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const catalog = useEditorSpeciesCatalog();
  const name = rule.label || 'Untitled rule';
  const mismatches = mismatchesForRule({
    age: rule.age,
    alignPackageId: rule.alignPackageId ?? null,
    plans,
  });
  const aligned = plans.find((plan) => plan.id === rule.alignPackageId) ?? null;
  const membershipOptions = plans.filter((plan) => planFitsRuleSpecies(plan, rule.species));
  const canSnap = aligned != null && (aligned.minAgeMonths != null || aligned.maxAgeMonths != null);
  return (
    <div className={`rl-cfg__card${rule.enabled ? '' : ' rl-cfg__card--off'}`}>
      <header className="rl-cfg__card-head">
        <EnabledSwitch checked={rule.enabled} onChange={(enabled) => onChange({ enabled })} />
        <button
          type="button"
          className="rl-cfg__card-toggle"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <span className="rl-cfg__card-title">{name}</span>
          <span className="rl-cfg__card-sub">
            {describeAgeWindow(rule.species, rule.age, catalog)} · {rule.options.length} panel
            {rule.options.length === 1 ? '' : 's'}
            {mismatches.length > 0 ? ' · age does not match membership' : ''}
          </span>
        </button>
        <RowActions label={name} index={index} total={total} onMove={onMove} onRemove={onRemove} />
      </header>
      {open ? (
        <div className="rl-cfg__card-body">
          <div className="rl-cfg__grid">
            <TextField
              label="Rule name"
              value={rule.label}
              hint="Only staff see this."
              placeholder="Puppy/kitten fecal"
              onChange={(label) => onChange({ label })}
            />
            <SpeciesFilterField
              label="Ask for"
              value={rule.species}
              onChange={(species) => onChange({ species })}
            />
            <NumberField
              label="Order"
              value={rule.sortOrder}
              hint="Lower numbers ask first."
              onChange={(n) => onChange({ sortOrder: n ?? 0 })}
            />
          </div>
          <AgeWindowField
            species={rule.species}
            age={rule.age}
            onChange={(age) => onChange({ age })}
          />
          <SelectField
            label="Membership this panel lines up with"
            value={rule.alignPackageId != null ? String(rule.alignPackageId) : ''}
            hint={aligned ? formatPlanAge(aligned) : membershipCutoffHint()}
            options={[
              { value: '', label: 'None' },
              ...membershipOptions.map((plan) => ({
                value: String(plan.id),
                label: plan.name,
              })),
            ]}
            onChange={(next) => onChange({ alignPackageId: next ? Number(next) : null })}
          />
          {canSnap && aligned ? (
            <div className="rl-cfg__snaps">
              <button
                type="button"
                className="rl-cfg__snap"
                onClick={() => onChange({ age: snapAgeToPlan(rule.age, aligned) })}
              >
                Match {aligned.name}&apos;s ages
              </button>
            </div>
          ) : null}
          {mismatches.map((row) => (
            <p key={row.message} className="rl-cfg__warn">
              {row.message}
            </p>
          ))}
          {overwriteAgeBasedPanels && rule.options.length <= 1 ? (
            <p className="rl-cfg__hint">
              Medical concern is set to replace this ask with the two-panel rule for this
              species. Change that under Medical concern.
            </p>
          ) : null}
          <HtmlField
            label="Shown above the panels"
            hint="Routine visit. {petName}, {doctorName}, {panel1}, and {panel2} fill in on the form. Prices stay on the choices."
            value={rule.introHtml}
            onChange={(introHtml) => onChange({ introHtml })}
          />
          <HtmlField
            label="Shown above the panels when there is a medical concern"
            hint="Used instead of the routine copy when staff flagged a concern. Same placeholders."
            value={rule.concernIntroHtml ?? ''}
            onChange={(concernIntroHtml) => onChange({ concernIntroHtml })}
          />
          <HtmlField
            label="Shown under the choices"
            hint="Routine visit. Same placeholders."
            value={rule.closingHtml ?? ''}
            onChange={(closingHtml) => onChange({ closingHtml })}
          />
          <HtmlField
            label="Shown under the choices when there is a medical concern"
            hint="Used instead of the routine closing when staff flagged a concern."
            value={rule.concernClosingHtml ?? ''}
            onChange={(concernClosingHtml) => onChange({ concernClosingHtml })}
          />
          <PanelOptionList
            practiceId={practiceId}
            options={rule.options}
            species={rule.species}
            plans={plans}
            onChange={(options) => onChange({ options })}
            onError={onError}
          />
          <PanelRuleClientPreview
            practiceId={practiceId}
            rule={rule}
            allRules={allRules}
            labsPage={labsPage}
            overwriteAgeBasedPanels={overwriteAgeBasedPanels}
          />
        </div>
      ) : null}
    </div>
  );
}

function previewPetName(species: RoomLoaderSpecies | RoomLoaderSpeciesSelection): string {
  const sel = asSpeciesSelection(species);
  if (sel.includes('cat') && !sel.includes('dog')) return 'Luna';
  if (sel.includes('dog')) return 'Ginger';
  return 'Pepper';
}

function previewEngineCtx(rule: RoomLoaderPanelRule, medicalConcern: boolean): EngineContext {
  const sel = asSpeciesSelection(rule.species);
  const species = sel.includes('dog')
    ? 'dog'
    : sel.find((slug) => slug !== ROOM_LOADER_ALL_SPECIES) ?? 'dog';
  return {
    species,
    ageMonths: 36,
    history: [],
    reminders: [],
    estimateLines: [],
    outdoorAccess: null,
    medicalConcern,
  };
}

function useCatalogListPrices(practiceId: number, rules: RoomLoaderPanelRule[], enabled: boolean) {
  const refs = useMemo(() => itemRefsFromPanelRules(rules), [rules]);
  const refKey = refs.map((ref) => `${ref.itemType}:${ref.itemId}`).sort().join(',');
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const current = refsRef.current;
    if (!enabled || !practiceId || current.length === 0) {
      setPrices({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      current.map(async (ref) => {
        const price = await fetchCatalogListPrice(ref, practiceId);
        return price == null ? null : { key: `${ref.itemType}:${ref.itemId}`, price };
      })
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const row of rows) {
        if (row && Number.isFinite(row.price)) next[row.key] = row.price;
      }
      setPrices(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, practiceId, refKey]);

  return (item: { itemType: string; itemId: number }) => {
    if (!(Number(item.itemId) > 0)) return null;
    const list = prices[`${item.itemType}:${item.itemId}`];
    return list == null ? null : roomLoaderPriceLabel(list, null);
  };
}

function PanelRuleClientPreview({
  practiceId,
  rule,
  allRules,
  labsPage,
  overwriteAgeBasedPanels,
}: {
  practiceId: number;
  rule: RoomLoaderPanelRule;
  allRules: RoomLoaderPanelRule[];
  labsPage: RoomLoaderLabsPageConfig;
  overwriteAgeBasedPanels: boolean;
}) {
  const [open, setOpen] = useState(false);
  const petName = previewPetName(rule.species);
  const doctorName = 'Dr. Cheeseman';
  const concernCtx = previewEngineCtx(rule, true);
  const concernRules = overwriteAgeBasedPanels
    ? medicalConcernPanelRules({ panelRules: allRules }, concernCtx)
    : [];
  const medicalRules = concernRules.length > 0 ? concernRules : [rule];
  const medicalSwitched = medicalRules[0]?.id != null && medicalRules[0].id !== rule.id;
  const previewRules = useMemo(() => [rule, ...medicalRules], [rule, medicalRules]);
  const priceFor = useCatalogListPrices(practiceId, previewRules, open);
  const labsPageSample =
    labsPage.imageUrl != null && labsPage.imageUrl !== ''
      ? { imageUrl: labsPage.imageUrl, imageCaption: labsPage.imageCaption ?? '' }
      : null;

  return (
    <div className="rl-cfg__preview">
      <button
        type="button"
        className="rl-cfg__snap"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Eye size={14} aria-hidden />
        {open ? 'Hide client preview' : 'Preview as client'}
      </button>
      {open ? (
        <div className="rl-cfg__preview-body">
          <p className="rl-cfg__hint">
            This is the labs question as the client sees it. Sample names fill {'{petName}'} and{' '}
            {'{doctorName}'} ({petName} and {doctorName}). Prices come from the catalog items
            above (list price from the catalog fields). On the live form they also adjust for
            membership and client discounts. Clients only see one pair of paragraphs at a time —
            routine or medical concern, never all four together.
            {medicalSwitched
              ? ` A medical-concern visit uses “${medicalRules[0].label || 'the two-panel rule'}” at any age.`
              : ''}
          </p>
          {rule.options.length === 0 ? (
            <p className="rl-cfg__empty">Add at least one panel above to preview the choices.</p>
          ) : (
            <div className="rl-cfg__preview-frames">
              <figure className="rl-cfg__preview-frame">
                <figcaption>Routine visit</figcaption>
                <div className="rl-cfg__preview-form">
                  <LabPanelsSection
                    petKey={`preview-routine-${rule.id}`}
                    petName={petName}
                    rules={[rule]}
                    ctx={previewEngineCtx(rule, false)}
                    formData={{}}
                    onChange={() => undefined}
                    priceFor={priceFor}
                    doctorName={doctorName}
                    disabled
                    labsPageSample={labsPageSample}
                  />
                </div>
              </figure>
              <figure className="rl-cfg__preview-frame">
                <figcaption>Medical concern</figcaption>
                <div className="rl-cfg__preview-form">
                  <LabPanelsSection
                    petKey={`preview-concern-${rule.id}`}
                    petName={petName}
                    rules={medicalRules}
                    ctx={concernCtx}
                    formData={{}}
                    onChange={() => undefined}
                    priceFor={priceFor}
                    doctorName={doctorName}
                    disabled
                    labsPageSample={labsPageSample}
                  />
                </div>
              </figure>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function UniversalOfferEditor({
  practiceId,
  offer,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  practiceId: number;
  offer: RoomLoaderUniversalOffer;
  index: number;
  total: number;
  onChange: (patch: Partial<RoomLoaderUniversalOffer>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [perSpecies, setPerSpecies] = useState(
    () => offer.itemBySpecies.dog != null || offer.itemBySpecies.cat != null
  );
  const catalog = useEditorSpeciesCatalog();
  const name = offer.displayName || itemLabel(offer.item) || 'Untitled offer';
  return (
    <div className={`rl-cfg__card${offer.enabled ? '' : ' rl-cfg__card--off'}`}>
      <header className="rl-cfg__card-head">
        <EnabledSwitch checked={offer.enabled} onChange={(enabled) => onChange({ enabled })} />
        <button
          type="button"
          className="rl-cfg__card-toggle"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <span className="rl-cfg__card-title">{name}</span>
          <span className="rl-cfg__card-sub">
            {describeSpeciesSelection(offer.species, catalog)}
          </span>
        </button>
        <RowActions label={name} index={index} total={total} onMove={onMove} onRemove={onRemove} />
      </header>
      {open ? (
        <div className="rl-cfg__card-body">
          <div className="rl-cfg__grid">
            <TextField
              label="Name the client sees"
              value={offer.displayName}
              onChange={(displayName) => onChange({ displayName })}
            />
            <SpeciesFilterField
              label="Offer to"
              value={offer.species}
              onChange={(species) => onChange({ species })}
            />
            <NumberField
              label="Order"
              value={offer.sortOrder}
              hint="Lower numbers show first."
              onChange={(n) => onChange({ sortOrder: n ?? 0 })}
            />
          </div>
          <div className="rl-cfg__field rl-cfg__field--wide">
            <span>Which item it adds</span>
            <div className="rl-cfg__radios">
              <label>
                <input
                  type="radio"
                  name={`rl-uni-${offer.id}`}
                  checked={!perSpecies}
                  onChange={() => {
                    setPerSpecies(false);
                    onChange({ itemBySpecies: { dog: null, cat: null } });
                  }}
                />
                <span>The same item for every species</span>
              </label>
              <label>
                <input
                  type="radio"
                  name={`rl-uni-${offer.id}`}
                  checked={perSpecies}
                  onChange={() => {
                    setPerSpecies(true);
                    onChange({ item: null });
                  }}
                />
                <span>A different item per species</span>
              </label>
            </div>
          </div>
          {perSpecies ? (
            <div className="rl-cfg__grid">
              <ItemField
                label="Dog item"
                practiceId={practiceId}
                value={offer.itemBySpecies.dog}
                onChange={(dog) => onChange({ itemBySpecies: { ...offer.itemBySpecies, dog } })}
              />
              <ItemField
                label="Cat item"
                practiceId={practiceId}
                value={offer.itemBySpecies.cat}
                onChange={(cat) => onChange({ itemBySpecies: { ...offer.itemBySpecies, cat } })}
              />
            </div>
          ) : (
            <div className="rl-cfg__grid">
              <ItemField
                label="Catalog item"
                practiceId={practiceId}
                value={offer.item}
                onChange={(item) => onChange({ item })}
              />
            </div>
          )}
          <HtmlField
            label="Description"
            value={offer.descriptionHtml}
            onChange={(descriptionHtml) => onChange({ descriptionHtml })}
          />
        </div>
      ) : null}
    </div>
  );
}

function DeclineReasonEditor({
  practiceId,
  reason,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  practiceId: number;
  reason: RoomLoaderDeclineReason;
  index: number;
  total: number;
  onChange: (patch: Partial<RoomLoaderDeclineReason>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const name = reason.label || itemLabel(reason.items?.[0] ?? null) || 'Untitled explanation';
  const count = (reason.items ?? []).length;
  return (
    <div className="rl-cfg__card">
      <header className="rl-cfg__card-head">
        <button
          type="button"
          className="rl-cfg__card-toggle"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <span className="rl-cfg__card-title">{name}</span>
          <span className="rl-cfg__card-sub">
            {count === 1 ? '1 catalog item' : `${count} catalog items`}
          </span>
        </button>
        <RowActions label={name} index={index} total={total} onMove={onMove} onRemove={onRemove} />
      </header>
      {open ? (
        <div className="rl-cfg__card-body">
          <TextField
            label="Internal name"
            value={reason.label}
            placeholder="Rabies"
            onChange={(label) => onChange({ label })}
          />
          <ItemRefList
            practiceId={practiceId}
            title="Applies to"
            note="Every catalog row this explanation covers — 1-year, 3-year, boosters, clinic SKUs."
            items={reason.items ?? []}
            addLabel="Add an item"
            onChange={(items) => onChange({ items })}
          />
          <HtmlField
            label="Shown when the client unchecks the row"
            value={reason.html}
            onChange={(html) => onChange({ html })}
          />
        </div>
      ) : null}
    </div>
  );
}

function ItemQuestionEditor({
  practiceId,
  question,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  practiceId: number;
  question: RoomLoaderItemQuestion;
  index: number;
  total: number;
  onChange: (patch: Partial<RoomLoaderItemQuestion>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const catalog = useEditorSpeciesCatalog();
  const choices = question.choices ?? [];
  const name = question.label || itemLabel(question.triggerItems?.[0] ?? null) || 'Untitled question';
  const patchChoice = (i: number, patch: Partial<RoomLoaderQuestionChoice>) =>
    onChange({ choices: choices.map((c, n) => (n === i ? { ...c, ...patch } : c)) });

  return (
    <div className={`rl-cfg__card${question.enabled ? '' : ' rl-cfg__card--off'}`}>
      <header className="rl-cfg__card-head">
        <EnabledSwitch checked={question.enabled} onChange={(enabled) => onChange({ enabled })} />
        <button
          type="button"
          className="rl-cfg__card-toggle"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <span className="rl-cfg__card-title">{name}</span>
          <span className="rl-cfg__card-sub">
            {describeAgeWindow(question.species, question.age, catalog)}
          </span>
        </button>
        <RowActions label={name} index={index} total={total} onMove={onMove} onRemove={onRemove} />
      </header>
      {open ? (
        <div className="rl-cfg__card-body">
          <div className="rl-cfg__grid">
            <TextField
              label="Internal name"
              value={question.label}
              placeholder="crLyme booster"
              onChange={(label) => onChange({ label })}
            />
            <SpeciesFilterField
              label="Ask"
              value={question.species}
              onChange={(species) => onChange({ species })}
            />
            <NumberField
              label="Order"
              value={question.sortOrder}
              hint="Lower numbers show first."
              onChange={(n) => onChange({ sortOrder: n ?? 0 })}
            />
          </div>
          <AgeWindowField
            species={question.species}
            age={question.age}
            onChange={(age) => onChange({ age })}
          />
          <TextField
            label="Question the client sees"
            value={question.questionText}
            placeholder="Would you like us to book {petName}'s booster after this visit?"
            hint="Use {petName} for the patient's name."
            onChange={(questionText) => onChange({ questionText })}
          />
          <HtmlField
            label="Help text under the question"
            value={question.helpHtml}
            onChange={(helpHtml) => onChange({ helpHtml })}
          />
          <ItemRefList
            practiceId={practiceId}
            title="Ask when one of these is on the estimate"
            note="The question only appears when staff already put one of these on this visit."
            items={question.triggerItems ?? []}
            addLabel="Add an item"
            onChange={(triggerItems) => onChange({ triggerItems })}
          />
          <ItemRefList
            practiceId={practiceId}
            title="Counts as having had it before"
            note="Every product form that means the pet has had this. Leave empty to use the trigger items above."
            items={question.historyItems ?? []}
            addLabel="Add an item"
            onChange={(historyItems) => onChange({ historyItems })}
          />
          <CheckField
            label="Only ask the first time — skip once the pet has had any of these"
            checked={question.askOnlyIfNeverHad}
            onChange={(askOnlyIfNeverHad) => onChange({ askOnlyIfNeverHad })}
          />
          <CheckField
            label="The client must answer before continuing"
            checked={question.required}
            onChange={(required) => onChange({ required })}
          />
          <div className="rl-cfg__sub">
            <div className="rl-cfg__sub-head">
              <h4 className="rl-cfg__sub-title">Answers</h4>
            </div>
            {choices.length === 0 ? (
              <p className="rl-cfg__empty">No answers yet. The question stays hidden until one exists.</p>
            ) : null}
            {choices.map((choice, i) => (
              <div className="rl-cfg__item-row" key={choice.id}>
                <input
                  type="text"
                  value={choice.label}
                  placeholder={`Answer ${i + 1}`}
                  aria-label={`Answer ${i + 1}`}
                  onChange={(e) => patchChoice(i, { label: e.target.value })}
                />
                <RowActions
                  label={choice.label || `Answer ${i + 1}`}
                  index={i}
                  total={choices.length}
                  onMove={(delta) => onChange({ choices: moveAt(choices, i, delta) })}
                  onRemove={() => onChange({ choices: choices.filter((_, n) => n !== i) })}
                />
              </div>
            ))}
            <AddButton
              label="Add an answer"
              onClick={() => onChange({ choices: [...choices, newQuestionChoice()] })}
            />
          </div>
          <HistoryGateEditor
            value={question.history}
            onChange={(history) => onChange({ history })}
          />
        </div>
      ) : null}
    </div>
  );
}

function SampleInstructionEditor({
  practiceId,
  instruction,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  practiceId: number;
  instruction: RoomLoaderSampleInstruction;
  index: number;
  total: number;
  onChange: (patch: Partial<RoomLoaderSampleInstruction>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const catalog = useEditorSpeciesCatalog();
  const name = instruction.label || instruction.heading || 'Untitled instructions';

  return (
    <div className={`rl-cfg__card${instruction.enabled ? '' : ' rl-cfg__card--off'}`}>
      <header className="rl-cfg__card-head">
        <EnabledSwitch
          checked={instruction.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
        <button
          type="button"
          className="rl-cfg__card-toggle"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <span className="rl-cfg__card-title">{name}</span>
          <span className="rl-cfg__card-sub">
            {describeSpeciesSelection(instruction.species, catalog)}
          </span>
        </button>
        <RowActions label={name} index={index} total={total} onMove={onMove} onRemove={onRemove} />
      </header>
      {open ? (
        <div className="rl-cfg__card-body">
          <div className="rl-cfg__grid">
            <TextField
              label="Internal name"
              value={instruction.label}
              placeholder="Stool sample — dogs"
              onChange={(label) => onChange({ label })}
            />
            <SpeciesFilterField
              label="Show for"
              value={instruction.species}
              onChange={(species) => onChange({ species })}
            />
            <NumberField
              label="Order"
              value={instruction.sortOrder}
              hint="Lower numbers show first."
              onChange={(n) => onChange({ sortOrder: n ?? 0 })}
            />
          </div>
          <TextField
            label="Heading"
            wide
            value={instruction.heading}
            placeholder="How to collect {petName}’s stool sample"
            hint={PET_NAME_HINT}
            onChange={(heading) => onChange({ heading })}
          />
          <HtmlField
            label="Instructions"
            value={instruction.bodyHtml}
            hint={PET_NAME_HINT}
            onChange={(bodyHtml) => onChange({ bodyHtml })}
          />
          <ItemRefList
            practiceId={practiceId}
            title="Show when one of these is being run"
            note="Every panel or test that needs this sample, including the panels that bundle it. A panel missing from this list shows nothing."
            items={instruction.triggerItems ?? []}
            addLabel="Add an item"
            onChange={(triggerItems) => onChange({ triggerItems })}
          />
        </div>
      ) : null}
    </div>
  );
}

function GatedOfferEditor({
  practiceId,
  offer,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  practiceId: number;
  offer: RoomLoaderGatedOffer;
  index: number;
  total: number;
  onChange: (patch: Partial<RoomLoaderGatedOffer>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const catalog = useEditorSpeciesCatalog();
  const name = offer.displayName || itemLabel(offer.item) || 'Untitled offer';
  return (
    <div className={`rl-cfg__card${offer.enabled ? '' : ' rl-cfg__card--off'}`}>
      <header className="rl-cfg__card-head">
        <EnabledSwitch checked={offer.enabled} onChange={(enabled) => onChange({ enabled })} />
        <button
          type="button"
          className="rl-cfg__card-toggle"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <span className="rl-cfg__card-title">{name}</span>
          <span className="rl-cfg__card-sub">
            {describeAgeWindow(offer.species, offer.age, catalog)}
          </span>
        </button>
        <RowActions label={name} index={index} total={total} onMove={onMove} onRemove={onRemove} />
      </header>
      {open ? (
        <div className="rl-cfg__card-body">
          <div className="rl-cfg__grid">
            <TextField
              label="Name the client sees"
              value={offer.displayName}
              placeholder={itemLabel(offer.item)}
              onChange={(displayName) => onChange({ displayName })}
            />
            <SpeciesFilterField
              label="Offer to"
              value={offer.species}
              onChange={(species) => onChange({ species })}
            />
            <ItemField
              label="Catalog item"
              practiceId={practiceId}
              value={offer.item}
              onChange={(item) => onChange({ item })}
            />
            <NumberField
              label="Order"
              value={offer.sortOrder}
              hint="Lower numbers show first."
              onChange={(n) => onChange({ sortOrder: n ?? 0 })}
            />
          </div>
          <AgeWindowField
            species={offer.species}
            age={offer.age}
            onChange={(age) => onChange({ age })}
          />
          <ItemRefList
            practiceId={practiceId}
            title="Also counts as already covered"
            note="Other products that mean the same thing — the annual form of a vaccine sold as an initial series, a combo product, a wellness clinic SKU. The offer is skipped when one of these is on the estimate or in the pet's history."
            items={offer.equivalentItems ?? []}
            addLabel="Add an item"
            onChange={(equivalentItems) => onChange({ equivalentItems })}
          />
          <CheckField
            label="Only offer when the owner says the pet goes outdoors"
            checked={offer.requiresOutdoorAccess}
            onChange={(requiresOutdoorAccess) => onChange({ requiresOutdoorAccess })}
          />
          <HtmlField
            label="Description"
            value={offer.descriptionHtml}
            onChange={(descriptionHtml) => onChange({ descriptionHtml })}
          />
          <HtmlField
            label="Shown if they cross it out"
            value={offer.cautionHtml}
            onChange={(cautionHtml) => onChange({ cautionHtml })}
          />
          <HistoryGateEditor value={offer.history} onChange={(history) => onChange({ history })} />
        </div>
      ) : null}
    </div>
  );
}
