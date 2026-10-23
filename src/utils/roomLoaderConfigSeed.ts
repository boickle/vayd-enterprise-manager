// src/utils/roomLoaderConfigSeed.ts
// Vet At Your Door's Room Loader starter document. QA and production pick this up
// when a practice has never saved Room Loader settings. Catalog `itemId`s are the
// current VAYD catalog; `code` travels with each ref so another environment can
// still match if ids drift.
import {
  emptyHistoryGate,
  normalizeRoomLoaderConfig,
  type RoomLoaderConfig,
  type RoomLoaderDeclineReason,
  type RoomLoaderGatedOffer,
  type RoomLoaderHistoryGate,
  type RoomLoaderItemQuestion,
  type RoomLoaderItemRef,
  type RoomLoaderItemType,
  type RoomLoaderPanelOption,
  type RoomLoaderPanelSubAsk,
  type RoomLoaderSampleInstruction,
} from './roomLoaderConfigTypes';

function item(
  itemType: RoomLoaderItemType,
  itemId: number,
  name: string,
  code: string
): RoomLoaderItemRef {
  return { itemType, itemId, name, code };
}

function gate(patch: Partial<RoomLoaderHistoryGate> = {}): RoomLoaderHistoryGate {
  return { ...emptyHistoryGate(), ...patch };
}

function yearlyReoffer(): RoomLoaderHistoryGate {
  return gate({
    suppressIfDoneWithinMonths: 10,
    suppressIfReminderDueBeyondMonths: 6,
    showEvenIfPreviouslyDeclined: true,
    reofferDeclinedAfterMonths: 10,
  });
}

/**
 * The bar the old Room Loader used for optional vaccines: skip the ask when the pet had
 * the vaccine in the last 15 months or already has a reminder due in the future, and
 * otherwise ask every visit even if the client said no last time.
 */
function annualVaccineGate(): RoomLoaderHistoryGate {
  return gate({
    suppressIfDoneWithinMonths: 15,
    suppressIfReminderDueBeyondMonths: 0,
    showEvenIfPreviouslyDeclined: true,
    reofferDeclinedAfterMonths: null,
  });
}

/** Vaccines offered by the care plan, with every product form that means "already covered". */
const LYME_INITIAL = item('inventory', 4263, 'crLyme Vaccine - Initial', 'LYMECRINITIAL');
const LYME_EQUIVALENTS = [
  item('inventory', 4262, 'crLyme Vaccine - Annual', 'LYMECR'),
  item('inventory', 445, 'Lyme/Lepto Combo Vaccine - Annual', 'LYME/LEPTOANNUAL'),
  item('inventory', 446, 'Lyme/Lepto Combo Vaccine - Initial', 'LYME/LEPTOINIT'),
  item('inventory', 3922, 'Wellness Clinic - crLyme Vaccine - Annual', 'WC-VXCLINICLYMEANNUAL'),
  item('inventory', 3923, 'Wellness Clinic - crLyme Vaccine - Initial', 'WC-VXCLINICLYMEINIT'),
];
const LEPTO_INITIAL = item('inventory', 62, 'Leptospirosis Vaccine - Initial', 'LEPTOINIT');
const LEPTO_EQUIVALENTS = [
  item('inventory', 64, 'Leptospirosis Vaccine - Annual', 'LEPTOANNUAL'),
  item('inventory', 445, 'Lyme/Lepto Combo Vaccine - Annual', 'LYME/LEPTOANNUAL'),
  item('inventory', 446, 'Lyme/Lepto Combo Vaccine - Initial', 'LYME/LEPTOINIT'),
  item('inventory', 3919, 'Wellness Clinic - Leptospirosis Vaccine - Annual', 'WC-VXCLINICLEPTOANNUAL'),
  item('inventory', 3918, 'Wellness Clinic - Leptospirosis Vaccine - Initial', 'WC-VXCLINICLEPTOINIT'),
];
const BORDETELLA = item('inventory', 2031, 'Bordetella Oral Vaccine - Annual', 'BORDORAL');
const BORDETELLA_EQUIVALENTS = [
  item('inventory', 3940, 'Wellness Clinic - Bordetella Oral Vaccine - Annual', 'WC-VXCLINICBORDORAL'),
];
const FELV_INITIAL = item('inventory', 74, 'FeLV (Leukemia) Vaccine - Initial', 'FELVINIT');
const FELV_EQUIVALENTS = [
  item('inventory', 76, 'FeLV (Leukemia) Vaccine - 1 year', 'FELV1'),
  item('inventory', 233, 'FeLV (Leukemia) Vaccine - 2 year', 'FELV2'),
  item('inventory', 3927, 'Wellness Clinic - FeLV (Leukemia) Vaccine - 1 year', 'WC-VXCLINICFELV1'),
  item('inventory', 3928, 'Wellness Clinic - FeLV (Leukemia) Vaccine - 2 year', 'WC-VXCLINICFELV2'),
  item('inventory', 3929, 'Wellness Clinic - FeLV (Leukemia) Vaccine - Initial', 'WC-VXCLINICFELVINT'),
];
const RABIES_ITEMS = [
  item('inventory', 56, 'Rabies Vaccine - 1 year', 'RABIES1'),
  item('inventory', 58, 'Rabies Vaccine - 3 year', 'RABIES3'),
  item('inventory', 2041, 'Rabies Feline Vaccine (Non-Purevax) - 1 year', 'RABIESFEL1'),
  item('inventory', 540, 'Rabies Feline Vaccine (Purevax) - 1 year', 'RABIESPUREVAX1'),
  item('inventory', 2915, 'Rabies Feline Vaccine (Purevax) - 3 year', 'RABIESPUREVAX3'),
  item('inventory', 3930, 'Wellness Clinic - Rabies Vaccine - 1 year', 'WC-VXCLINICRABIES1'),
  item('inventory', 3931, 'Wellness Clinic - Rabies Vaccine - 1 year (package)', 'WC-VXCLINICRABIES1INC'),
  item('inventory', 3932, 'Wellness Clinic - Rabies Vaccine - 3 year', 'WC-VXCLINICRABIES3'),
  item('inventory', 3933, 'Wellness Clinic - Rabies Vaccine - 3 year (package)', 'WC-VXCLINICRABIES3INC'),
];
const FVRCP_ITEMS = [
  item('inventory', 71, 'FVRCP (Distemper) Initial Vaccine', 'FVRCPBOOST'),
  item('inventory', 73, 'FVRCP (Distemper) Vaccine - 1 year', 'FVRCP1'),
  item('inventory', 232, 'FVRCP (Distemper) Vaccine - 3 year', 'FVRCP3'),
  item('inventory', 3625, 'FVRCP Booster', 'FVRCPBOOSTER2'),
  item('inventory', 3644, 'FVRCP (Distemper) Vaccine - Litter', 'FVRCPLITTER'),
  item('inventory', 3926, 'Wellness Clinic - FVRCP (Distemper) Vaccine - 1 year', 'WC-VXCLINICFVRCP1'),
  item('inventory', 3925, 'Wellness Clinic - FVRCP (Distemper) Vaccine - 3 year', 'WC-VXCLINICFVRCP3'),
  item('inventory', 3924, 'Wellness Clinic - FVRCP (Distemper) Vaccine Booster', 'WC-VXCLINICFVRCPBOOST'),
];
const DAPP_ITEMS = [
  item('inventory', 2034, 'DAPP (Distemper) Vaccine - 1 year', 'DAPP1'),
  item('inventory', 2035, 'DAPP (Distemper) Vaccine - 3 year', 'DAPP3'),
  item('inventory', 2033, 'DAPP (Distemper) Vaccine Booster', 'DAPPBOOST'),
  item('inventory', 2190, 'DAPP (Distemper) Vaccine - Litter', 'DAPPLITTER'),
  item('inventory', 3916, 'Wellness Clinic - DAPP (Distemper) Vaccine - 1 year', 'WC-VXCLINICDAPP1'),
  item('inventory', 3917, 'Wellness Clinic - DAPP (Distemper) Vaccine - 3 year', 'WC-VXCLINICDAPP3'),
  item('inventory', 3915, 'Wellness Clinic - DAPP (Distemper) Vaccine Booster', 'WC-VXCLINICDAPPBOOSTER'),
];

const FECAL_O_P = item('lab', 137, 'Fecal Ova & Parasites', 'FIL5010');
const FECAL_COMP = item('lab', 139, 'Comprehensive Fecal (O&P + Giardia)', 'FIL24639');
const CANINE_4DX = item('lab', 132, 'Heartworm / Tick Test (4Dx)', 'F4DX');
const FELINE_3DX = item('lab', 992, 'Feline Tripe Snap Test (FELV/FIV/HW)  - in house', 'FELINE3DX');
const FELINE_3DX_LAB = item('lab', 901, 'Lab Feline Triple Test (FIV/FeLV/HW)', 'IL3755');
const EARLY_DOG = item('lab', 953, 'Early Detection Panel - Canine', 'FIL48719999');
const EARLY_CAT = item('lab', 954, 'Early Detection Panel - Feline', 'FIL48119999');
const SENIOR_STD = item('lab', 128, 'Senior Screen (chem 25, CBC, T4, UA)', 'FIL8659999');
const SENIOR_DOG_EXT = item(
  'lab',
  134,
  'Senior Screen Canine (4Dx, Fecal O&P, chem 25, CBC, T4, UA)',
  'FIL25659999'
);
const SENIOR_CAT_EXT = item(
  'lab',
  942,
  'Senior Screen Feline (Fecal Dx, felv/fiv/hw, fPL, chem 25, CBC, T4, UA)',
  'FIL45129999'
);

/**
 * Which panels send the owner off to collect something. The standard senior screen is
 * deliberately absent from both: nothing on it is owner-collected.
 */
const SAMPLE_INSTRUCTIONS: RoomLoaderSampleInstruction[] = [
  {
    id: 'sample_stool_dog',
    enabled: true,
    label: 'Stool sample — dogs',
    species: ['dog'],
    triggerItems: [FECAL_COMP, FECAL_O_P, EARLY_DOG, SENIOR_DOG_EXT],
    heading: 'How to collect {petName}’s stool sample',
    bodyHtml:
      '<p>Please set aside a stool sample for us before the visit. A piece about the size of a grape is plenty, and it should be from the last 12 hours or so.</p><p>Seal it in a plastic bag or a clean container, label it with {petName}’s name, and keep it in the refrigerator until we arrive. If you cannot get one in time, we can send a container home with you.</p>',
    sortOrder: 0,
  },
  {
    id: 'sample_stool_cat',
    enabled: true,
    label: 'Stool sample — cats',
    species: ['cat'],
    triggerItems: [FECAL_COMP, FECAL_O_P, EARLY_CAT, SENIOR_CAT_EXT],
    heading: 'How to collect {petName}’s stool sample',
    bodyHtml:
      '<p>Please scoop a stool sample out of the litter box before the visit. A piece about the size of a grape is plenty, it should be from the last 12 hours or so, and a little litter stuck to it is fine.</p><p>Seal it in a plastic bag or a clean container, label it with {petName}’s name, and keep it in the refrigerator until we arrive. If you cannot get one in time, we can send a container home with you.</p>',
    sortOrder: 1,
  },
  {
    id: 'sample_urine_dog',
    enabled: true,
    label: 'Urine sample — dogs',
    species: ['dog'],
    triggerItems: [SENIOR_DOG_EXT],
    heading: 'How to collect {petName}’s urine sample',
    bodyHtml:
      '<p>A urine sample caught the morning of the visit tells us the most. Take {petName} out on a leash and slide a clean, shallow container &mdash; a pie plate or a soup ladle works well &mdash; into the stream once they start going.</p><p>Pour it into a clean sealed container, note the time you collected it, and keep it in the refrigerator. Do not worry if you cannot catch one; we can usually collect it at the visit.</p>',
    sortOrder: 2,
  },
  {
    id: 'sample_urine_cat',
    enabled: true,
    label: 'Urine sample — cats',
    species: ['cat'],
    triggerItems: [SENIOR_CAT_EXT],
    heading: 'How to collect {petName}’s urine sample',
    bodyHtml:
      '<p>A urine sample caught the morning of the visit tells us the most. Empty and rinse the litter box, then refill it with non-absorbent litter or a thin layer of clean aquarium gravel so the urine pools instead of soaking in.</p><p>Pour what {petName} passes into a clean sealed container, note the time you collected it, and keep it in the refrigerator. Do not worry if you cannot catch one; we can usually collect it at the visit.</p>',
    sortOrder: 3,
  },
];

function option(
  id: string,
  ref: RoomLoaderItemRef,
  extras: Partial<RoomLoaderPanelOption> & Pick<RoomLoaderPanelOption, 'displayName' | 'descriptionHtml'>
): RoomLoaderPanelOption {
  return {
    id,
    item: ref,
    imageUrl: null,
    imageCaption: '',
    replacesItems: [],
    subAsks: [],
    ...extras,
  };
}

function subAsk(
  id: string,
  ref: RoomLoaderItemRef,
  extras: Partial<RoomLoaderPanelSubAsk>
): RoomLoaderPanelSubAsk {
  return {
    id,
    item: ref,
    displayName: extras.displayName ?? '',
    cautionHtml: extras.cautionHtml ?? '',
    requiresOutdoorAccess: extras.requiresOutdoorAccess ?? false,
    history: extras.history ?? emptyHistoryGate(),
  };
}

/** True when the practice has never configured Room Loader (API empty document). */
export function roomLoaderConfigIsUnconfigured(config: RoomLoaderConfig): boolean {
  return (
    config.panelRules.length === 0 &&
    config.universalOffers.length === 0 &&
    config.gatedOffers.length === 0 &&
    !config.outdoor.enabled &&
    !config.chronicMeds.enabled &&
    !config.productGuide.enabled
  );
}

/**
 * Sample-collection copy arrived after practices had saved a document, so a stored
 * config written before it has no `sampleInstructions` key at all and gets the starter
 * boxes. An empty array means staff cleared them on purpose and is left alone.
 */
function withSampleInstructionBackfill(raw: unknown, config: RoomLoaderConfig): RoomLoaderConfig {
  const stored = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (stored && 'sampleInstructions' in stored) return config;
  return { ...config, sampleInstructions: SAMPLE_INSTRUCTIONS };
}

/** Use the VAYD starter document when the practice has not saved one yet. */
export function resolveRoomLoaderConfig(raw: unknown): RoomLoaderConfig {
  const config = normalizeRoomLoaderConfig(raw);
  if (roomLoaderConfigIsUnconfigured(config)) return vaydRoomLoaderConfigSeed();
  return withSampleInstructionBackfill(raw, config);
}

/**
 * The starter vaccine asks on their own, so a practice that already tuned its panels can
 * adopt them without replacing the whole document.
 */
export function vaydVaccineGatedOffers(): RoomLoaderGatedOffer[] {
  return vaydRoomLoaderConfigSeed().gatedOffers;
}

/** The starter "why we recommend this" copy on its own, for the same reason. */
export function vaydDeclineReasons(): RoomLoaderDeclineReason[] {
  return vaydRoomLoaderConfigSeed().declineReasons;
}

/** The starter estimate-line questions on their own, for the same reason. */
export function vaydItemQuestions(): RoomLoaderItemQuestion[] {
  return vaydRoomLoaderConfigSeed().itemQuestions;
}

/** The starter stool / urine collection copy on its own, for the same reason. */
export function vaydSampleInstructions(): RoomLoaderSampleInstruction[] {
  return vaydRoomLoaderConfigSeed().sampleInstructions;
}

/** The settings captured from VAYD Room Loader for this release. */
export function vaydRoomLoaderConfigSeed(): RoomLoaderConfig {
  return normalizeRoomLoaderConfig({
    panelRules: [
      {
        id: 'r_puppy',
        label: 'Puppy / kitten fecal',
        enabled: true,
        species: ['dog', 'cat'],
        age: { minMonths: 0, maxMonths: 6 },
        introHtml: '',
        concernIntroHtml: '',
        closingHtml: '',
        concernClosingHtml: '',
        alignPackageId: null,
        sortOrder: 0,
        options: [
          option('o_fecal', FECAL_COMP, {
            displayName: 'Comprehensive Fecal (O&P + Giardia)',
            descriptionHtml:
              '<p>Young pets pick up intestinal parasites easily, and some spread to people. This checks a stool sample for the common ones plus giardia.</p>',
            replacesItems: [FECAL_O_P],
          }),
        ],
      },
      {
        id: 'r_early_dog',
        label: 'Adult dog early detection',
        enabled: true,
        species: ['dog'],
        age: { minMonths: 6, maxMonths: 96 },
        introHtml:
          '<p>We recommend an {panel1} as part of routine preventive care. This screening establishes baseline values, helps us monitor trends over time, and can identify subtle changes before pets show symptoms.</p><p><strong>The {panel1} includes:</strong></p>',
        concernIntroHtml: '',
        closingHtml:
          '<p>Most families choose to include this screening so we have baseline information available if {petName} ever becomes sick.</p>',
        concernClosingHtml: '',
        alignPackageId: 1289,
        sortOrder: 1,
        options: [
          option('o_ed', EARLY_DOG, {
            displayName: 'Early Detection Panel',
            descriptionHtml:
              '<ul><li><strong>Chemistry Panel</strong> (liver and kidney function)</li><li><strong>Complete Blood Count</strong> (CBC)</li><li>Fecal parasite screening</li><li>4Dx (Heartworm and tick-borne disease screening — Lyme, Anaplasma, and Ehrlichia)</li></ul>',
            replacesItems: [CANINE_4DX, FECAL_COMP, FECAL_O_P],
            subAsks: [
              subAsk('s_4dx', CANINE_4DX, {
                displayName: 'Heartworm / Tick Test (4Dx)',
                cautionHtml:
                  '<p>Heartworm disease is spread by mosquitoes and is preventable. We recommend testing every year before refilling prevention.</p>',
                history: yearlyReoffer(),
              }),
              subAsk('s_fecal', FECAL_O_P, {
                displayName: 'Fecal Analysis',
                cautionHtml:
                  '<p>Checks for roundworms, hookworms, and whipworms, several of which can spread to people.</p>',
                history: yearlyReoffer(),
              }),
            ],
          }),
        ],
      },
      {
        id: 'r_early_cat',
        label: 'Adult cat early detection',
        enabled: true,
        species: ['cat'],
        age: { minMonths: 6, maxMonths: 96 },
        introHtml:
          '<p>We recommend an {panel1} as part of routine preventive care. This screening establishes baseline values, helps us monitor trends over time, and can identify subtle changes before pets show symptoms.</p><p><strong>The {panel1} includes:</strong></p>',
        concernIntroHtml: '',
        closingHtml:
          '<p>Most families choose to include this screening so we have baseline information available if {petName} ever becomes sick.</p>',
        concernClosingHtml: '',
        alignPackageId: 1309,
        sortOrder: 2,
        options: [
          option('o_edf', EARLY_CAT, {
            displayName: 'Early Detection Panel',
            descriptionHtml:
              '<ul><li><strong>Chemistry Panel</strong> (liver and kidney function)</li><li><strong>Complete Blood Count</strong> (CBC)</li><li>Fecal parasite screening</li><li>FIV/FeLV/Heartworm screening</li></ul>',
            replacesItems: [FECAL_COMP, FECAL_O_P, FELINE_3DX, FELINE_3DX_LAB],
            subAsks: [
              subAsk('ask_mur7n8upp3vwd5', FECAL_O_P, {
                history: gate({
                  suppressIfDoneWithinMonths: 10,
                  suppressIfReminderDueBeyondMonths: 6,
                  showEvenIfPreviouslyDeclined: true,
                  reofferDeclinedAfterMonths: 11,
                }),
              }),
              subAsk('ask_mur7o1p4i05nwj', FELINE_3DX, {
                requiresOutdoorAccess: true,
                history: gate({
                  suppressIfDoneWithinMonths: 10,
                  suppressIfReminderDueBeyondMonths: 6,
                  showEvenIfPreviouslyDeclined: true,
                  reofferDeclinedAfterMonths: 11,
                }),
              }),
            ],
          }),
        ],
      },
      {
        id: 'rule_senior_dog',
        label: 'Senior dog screen',
        enabled: true,
        species: ['dog'],
        age: { minMonths: 96, maxMonths: null },
        introHtml:
          "<p>It looks like {petName} is due for Annual Comprehensive Lab Work, which helps us gain helpful insight into {petName}'s overall health and trends over time.</p><p>We have two panels to choose from.</p>",
        concernIntroHtml:
          '<p>With the symptoms you mentioned for {petName}, {doctorName} is likely to recommend lab work in order to gain valuable insight into why {petName} might be displaying these symptoms.</p><p>We have two panels to choose from.</p>',
        closingHtml:
          '<p>Conducting annual lab work aligns with the proactive essence of our philosophy by enabling early detection and tailored care strategies, ensuring optimal health outcomes for {petName}.</p>',
        concernClosingHtml:
          "<p>Lab work can help identify underlying causes of {petName}'s symptoms and guide the doctor in choosing the most appropriate treatment plan.</p>",
        alignPackageId: 1167,
        sortOrder: 3,
        options: [
          option('opt_senior_basic', SENIOR_STD, {
            displayName: 'Standard Comprehensive Panel',
            descriptionHtml:
              '<ul><li><strong>Chemistry</strong> to look at organ function such as liver or kidneys.</li><li><strong>Complete Blood Count</strong> to look at red/white blood cell and platelet counts.</li><li><strong>Thyroid level</strong>, as this level can go below normal in middle and older aged dogs.</li><li><strong>Urinalysis</strong>, to look at kidney and urinary health.</li></ul>',
          }),
          option('opt_senior_ext', SENIOR_DOG_EXT, {
            displayName: 'Extended Comprehensive Panel',
            descriptionHtml:
              '<p>This panel includes everything in the {panel1} and also includes:</p><ul><li>Heartworm/tick disease screening test (called "4Dx").</li><li>Stool sample analysis for parasites ("Fecal").</li></ul>',
            replacesItems: [
              item('lab', 132, 'Heartworm/Tick 4Dx', 'F4DX'),
              item('lab', 139, 'Comprehensive Fecal', 'FIL24639'),
            ],
            subAsks: [
              subAsk('ask_s_4dx', item('lab', 132, 'Heartworm/Tick 4Dx', 'F4DX'), {
                displayName: 'Heartworm & tick screen (4Dx)',
                cautionHtml:
                  '<p>Heartworm is spread by mosquitoes and is far cheaper to prevent than to treat. Ticks in our area also carry Lyme and anaplasmosis.</p>',
              }),
              subAsk('ask_s_fecal', item('lab', 139, 'Comprehensive Fecal', 'FIL24639'), {
                displayName: 'Intestinal parasite screen',
                cautionHtml:
                  '<p>Giardia and other intestinal parasites often cause no visible signs, and some can spread to people in the household.</p>',
              }),
            ],
          }),
        ],
      },
      {
        id: 'rule_senior_cat',
        label: 'Senior cat screen',
        enabled: true,
        species: ['cat'],
        age: { minMonths: 96, maxMonths: null },
        introHtml:
          "<p>For senior cats, we recommend our Senior Screen Feline—a comprehensive panel that gives us a clear picture of {petName}'s organ function, thyroid, and infectious disease status. We have two panels to choose from.</p>",
        concernIntroHtml:
          '<p>With the symptoms you mentioned for {petName}, {doctorName} is likely to recommend lab work in order to gain valuable insight into why {petName} might be displaying these symptoms.</p><p>We have two panels to choose from.</p>',
        closingHtml: '',
        concernClosingHtml:
          "<p>Lab work can help identify underlying causes of {petName}'s symptoms and guide the doctor in choosing the most appropriate treatment plan.</p>",
        alignPackageId: 1165,
        sortOrder: 4,
        options: [
          option('opt_senior_cat_std', SENIOR_STD, {
            displayName: 'Standard Comprehensive Panel',
            descriptionHtml:
              '<ul><li><strong>Chemistry</strong> to look at organ function like the liver and kidneys.</li><li><strong>Complete Blood Count</strong> to look at red/white blood cell and platelet counts.</li><li><strong>Thyroid level</strong>, which may increase in older cats.</li><li><strong>Urinalysis</strong>, to look at kidney and urinary health.</li></ul>',
          }),
          option('opt_senior_cat_ext', SENIOR_CAT_EXT, {
            displayName: 'Extended Comprehensive Panel',
            descriptionHtml:
              '<p>This panel includes everything in the {panel1} and also includes:</p><ul><li>A screening (called "fPL") for chronic pancreatitis. This is a condition that is common in older cats, causes vague symptoms, and doesn\'t usually show itself on a standard comprehensive panel.</li><li>Stool sample analysis for parasites ("Fecal").</li><li>Screening for three infectious diseases: FIV, FeLV, and Heartworm.</li></ul>',
            replacesItems: [item('lab', 139, 'Comprehensive Fecal', 'FIL24639')],
            subAsks: [
              subAsk('ask_cat_fecal', item('lab', 139, 'Comprehensive Fecal', 'FIL24639'), {
                displayName: 'Intestinal parasite screen',
                cautionHtml:
                  '<p>Giardia and other intestinal parasites often cause no visible signs, and some can spread to people in the household.</p>',
              }),
            ],
          }),
        ],
      },
    ],
    universalOffers: [
      {
        id: 'u_ped',
        enabled: true,
        displayName: 'Nail trim / pedicure',
        species: ['dog', 'cat'],
        descriptionHtml: '<p>A quick trim while we are with you.</p>',
        item: null,
        itemBySpecies: {
          dog: item('procedure', 55, 'Pedicure - Dog', 'K9NT'),
          cat: item('procedure', 1727, 'Pedicure - Cat', 'FELINENT'),
        },
        sortOrder: 0,
      },
      {
        id: 'u_chip',
        enabled: true,
        displayName: 'Microchip',
        species: ['any'],
        descriptionHtml: '<p>Permanent identification if your pet ever goes missing.</p>',
        item: item('procedure', 96, 'HomeAgain Microchip', 'MICROCHIP'),
        itemBySpecies: { dog: null, cat: null },
        sortOrder: 1,
      },
      {
        id: 'uni_mur5oynyb0kdn1',
        enabled: true,
        displayName: 'Ear cleaning',
        species: ['any'],
        descriptionHtml: '',
        item: item('procedure', 45, 'Ear Cleaning 1', 'EAR1'),
        itemBySpecies: { dog: null, cat: null },
        sortOrder: 2,
      },
      {
        id: 'uni_mur5phmgsfhzaw',
        enabled: true,
        displayName: 'Anal gland expression',
        species: ['dog'],
        descriptionHtml: '',
        item: item('procedure', 59, 'Anal Gland Expression', 'XAG'),
        itemBySpecies: { dog: null, cat: null },
        sortOrder: 3,
      },
    ],
    gatedOffers: [
      {
        id: 'vax_lyme',
        enabled: true,
        displayName: 'Lyme (crLyme) vaccine',
        species: ['dog'],
        item: LYME_INITIAL,
        equivalentItems: LYME_EQUIVALENTS,
        age: { minMonths: 0, maxMonths: null },
        history: annualVaccineGate(),
        requiresOutdoorAccess: false,
        descriptionHtml:
          '<p>It looks like {petName} has not received a Lyme vaccine within the past 15 months and may not be fully protected at this time.</p><p>Lyme disease is extremely common in our area due to the high number of ticks. While many dogs can be exposed without symptoms, about 10&ndash;15% develop serious issues like painful joints &mdash; and in rare cases, life-threatening kidney disease.</p><p>Because of the risk where we live, <strong>Vet At Your Door considers Lyme a core vaccine for all dogs.</strong></p><p>To protect {petName}, we recommend starting the vaccine series now. It will involve two vaccines, 3&ndash;4 weeks apart, followed by an annual booster.</p>',
        cautionHtml:
          '<p>Lyme disease is extremely common in our area due to the high number of ticks. Because of this risk, Vet At Your Door considers the Lyme vaccine a core vaccine for dogs to help prevent painful joint disease and rare but serious kidney complications.</p>',
        sortOrder: 0,
      },
      {
        id: 'vax_lepto',
        enabled: true,
        displayName: 'Leptospirosis vaccine',
        species: ['dog'],
        item: LEPTO_INITIAL,
        equivalentItems: LEPTO_EQUIVALENTS,
        age: { minMonths: 0, maxMonths: null },
        history: annualVaccineGate(),
        requiresOutdoorAccess: false,
        descriptionHtml:
          '<p>It looks like {petName} has not received a Leptospirosis vaccine within the past 15 months and may not be fully protected at this time.</p><p>Leptospirosis is a serious bacterial infection that can be life-threatening for dogs &mdash; and can also spread to humans. It is carried in the urine of wild animals, and dogs can contract it simply by drinking from puddles or streams.</p><p>Based on updated veterinary guidelines (from AAHA, ACVIM, and WSAVA) and the risks in our area, <strong>Vet At Your Door now considers Leptospirosis a core vaccine for all dogs.</strong></p><p>To protect {petName}, we recommend starting the vaccine series at your visit. It will involve two vaccines, 3&ndash;4 weeks apart, then an annual booster to stay protected.</p>',
        cautionHtml:
          '<p>Leptospirosis is a serious bacterial infection that dogs can contract from water contaminated with wildlife urine, such as puddles or streams. Because it can be life-threatening for dogs and can also spread to humans, Vet At Your Door considers the Leptospirosis vaccine a core vaccine for dogs.</p>',
        sortOrder: 1,
      },
      {
        id: 'vax_bordetella',
        enabled: true,
        displayName: 'Bordetella ("kennel cough") vaccine',
        species: ['dog'],
        item: BORDETELLA,
        equivalentItems: BORDETELLA_EQUIVALENTS,
        age: { minMonths: 0, maxMonths: null },
        history: annualVaccineGate(),
        requiresOutdoorAccess: false,
        descriptionHtml:
          '<p>It does not look like {petName} has received the Bordetella ("Kennel Cough") vaccine in the last year.</p><p>We recommend this vaccine for dogs under a year old and for adult dogs who are boarded, go to doggy day care, or take group training classes.</p>',
        cautionHtml:
          '<p>Bordetella ("kennel cough") is a contagious respiratory infection that spreads easily anywhere dogs gather, such as boarding facilities, daycare, grooming, or training classes. This vaccine helps protect dogs who have contact with other dogs and reduces the risk of infection.</p>',
        sortOrder: 2,
      },
      {
        id: 'vax_felv_kitten',
        enabled: true,
        displayName: 'FeLV (Leukemia) vaccine',
        species: ['cat'],
        item: FELV_INITIAL,
        equivalentItems: FELV_EQUIVALENTS,
        age: { minMonths: 0, maxMonths: 12 },
        // Kittens are vaccinated once regardless of lifestyle, so "ever had it" is the bar.
        history: gate({
          suppressIfDoneWithinMonths: 240,
          suppressIfReminderDueBeyondMonths: 0,
          showEvenIfPreviouslyDeclined: true,
          reofferDeclinedAfterMonths: null,
        }),
        requiresOutdoorAccess: false,
        descriptionHtml:
          '<p>We recommend the feline leukemia vaccine for every cat under one year of age, whatever their lifestyle, because kittens are the most susceptible and their time outdoors often changes as they grow.</p>',
        cautionHtml:
          "<p>Feline Leukemia Virus (FeLV) is a contagious virus that weakens a cat's immune system and can lead to serious illness. We recommend this vaccine for all cats under one year of age, as well as adult cats that go outdoors or live with cats who have outdoor exposure.</p>",
        sortOrder: 3,
      },
    ],
    itemQuestions: [
      {
        id: 'ask_crlyme_booster',
        enabled: true,
        label: 'crLyme booster appointment',
        species: ['dog'],
        age: { minMonths: 0, maxMonths: null },
        triggerItems: [LYME_INITIAL],
        historyItems: [LYME_INITIAL, ...LYME_EQUIVALENTS],
        askOnlyIfNeverHad: true,
        // They are getting the vaccine this visit either way, so a decline years ago
        // should not stop us asking whether to hold the booster slot.
        history: gate({ showEvenIfPreviouslyDeclined: true }),
        questionText:
          'Do you want us to schedule {petName} a booster appointment after this visit? (crLyme)',
        helpHtml:
          '<p>The first Lyme vaccine needs a second dose two to four weeks later to work. We can hold that spot for you now.</p>',
        required: true,
        choices: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
          { id: 'unsure', label: "I'm not sure" },
        ],
        sortOrder: 0,
      },
      {
        id: 'ask_cat_rabies_form',
        enabled: true,
        label: 'Cat rabies 1-year vs 3-year',
        species: ['cat'],
        age: { minMonths: 0, maxMonths: null },
        triggerItems: RABIES_ITEMS,
        historyItems: [],
        askOnlyIfNeverHad: false,
        history: gate({ showEvenIfPreviouslyDeclined: true }),
        questionText:
          'We offer two rabies vaccines for cats — a one year and a three year. Which would you prefer for {petName}?',
        helpHtml: '',
        required: true,
        choices: [
          { id: '1year', label: 'Purevax Rabies 1 year' },
          { id: '3year', label: 'Purevax Rabies 3 year' },
          { id: 'no', label: 'No thank you, I do not want a rabies vaccine given to my cat.' },
        ],
        sortOrder: 1,
      },
    ],
    outdoor: {
      enabled: true,
      species: ['cat'],
      questionText: 'Does {petName} go outdoors, or live with a cat who does?',
      required: true,
      pitchHtml:
        '<p>It appears that {petName} has either not started the FeLV (Feline Leukemia) vaccine series or is not currently up to date.</p><p>FeLV is a contagious and potentially fatal virus spread through close contact between cats, like grooming or sharing food and water bowls.</p><p>Based on updated veterinary guidelines, FeLV is now considered a core vaccine for all kittens under one year old, regardless of whether they live indoors or outdoors. We also highly recommend it for any adult cats who go outside or live with cats who do.</p><p>Do you want us to give the FeLV vaccine? For initial immunity, two vaccines must be given, 3&ndash;4 weeks apart.</p>',
      pitchItem: item('inventory', 76, 'FeLV (Leukemia) Vaccine - 1 year', 'FELV1'),
      pitchDisplayName: '',
      pitchCautionHtml: '',
      history: gate({ suppressIfDoneWithinMonths: 24 }),
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
      headline: "See how a membership could change today's bill",
      subheadHtml: '<p>Most families save on the care they already planned.</p>',
      expandLabel: 'See the full comparison',
      collapseLabel: 'Hide the comparison',
    },
    chronicMeds: {
      enabled: true,
      questionText: 'Does {petName} need a refill of any ongoing medication?',
      introHtml: '<p>We can bring it with us or ship it to you.</p>',
      allowBring: true,
      bringLabel: 'Bring it to the visit',
      allowShip: true,
      shipLabel: 'Ship it to me',
      allowFreeText: true,
      freeTextLabel: 'Something else we should bring',
    },
    labsPage: {
      title: 'Lab work we recommend',
      introHtml:
        '<p>These are the tests we suggest based on age and species. Everything here is optional.</p>',
      medicalConcernIntroHtml:
        '<p>Because you mentioned a concern, the doctor would like to run these.</p>',
      imageUrl: '/early-detection-feline.png',
      imageCaption: 'How values trend over time',
    },
    sampleInstructions: SAMPLE_INSTRUCTIONS,
    productGuide: {
      enabled: true,
      summaryLabel: 'Learn more about flea, tick & heartworm prevention we offer',
      tables: [
        {
          id: 'guide_dog',
          species: ['dog'],
          heading: 'Recommended parasite prevention options for dogs',
          noteHtml:
            '<p><strong>Note:</strong> We recently transitioned from Simparica Trio to Credelio Quattro as our primary all-in-one parasite prevention for dogs. Credelio Quattro also includes tapeworm coverage.</p>',
          rows: [
            {
              id: 'row_d1',
              approach: 'One and Done',
              medication: 'Credelio Quattro',
              schedule: 'Monthly chew',
              coversHtml: '<p>Fleas, ticks, heartworm, intestinal parasites</p>',
            },
            {
              id: 'row_d2',
              approach: 'Less is More',
              medication: 'Bravecto + Interceptor Plus',
              schedule: 'Bravecto every 3 months + monthly Interceptor Plus',
              coversHtml:
                '<ul><li>Bravecto: Fleas and ticks</li><li>Interceptor Plus: Heartworm and intestinal parasites</li></ul>',
            },
          ],
          footerHtml:
            '<p>These options are commonly used for dogs in our area. If you&rsquo;d like us to bring one of these medications, simply search for it above and add it to your visit.</p>',
          sortOrder: 0,
        },
        {
          id: 'guide_cat',
          species: ['cat'],
          heading: 'Recommended parasite prevention options for cats',
          noteHtml: '',
          rows: [
            {
              id: 'row_c1',
              approach: 'All-in-One Protection',
              medication: 'Revolution Plus',
              schedule: 'Monthly topical',
              coversHtml: '<p>Fleas, ticks, heartworm, and intestinal parasites (except tapeworms)</p>',
            },
            {
              id: 'row_c2',
              approach: 'Oral Option',
              medication: 'Credelio + Profender',
              schedule: 'Credelio monthly chew + Profender every 3 months',
              coversHtml: '<p>Fleas, ticks, and intestinal parasites including tapeworms</p>',
            },
            {
              id: 'row_c3',
              approach: 'Less Frequent Flea/Tick Dosing',
              medication: 'Bravecto + Profender',
              schedule: 'Bravecto topical every 3 months + Profender every 3 months',
              coversHtml: '<p>Fleas, ticks, and intestinal parasites including tapeworms</p>',
            },
          ],
          footerHtml:
            '<p>Credelio and Bravecto provide excellent flea and tick protection but do not cover intestinal parasites. For <strong>outdoor cats</strong>, we typically recommend adding <strong>Profender every 3 months</strong> for broader parasite protection.</p>',
          sortOrder: 1,
        },
      ],
    },
    declineReasons: [
      {
        id: 'why_rabies',
        label: 'Rabies',
        items: RABIES_ITEMS,
        html: '<p>Rabies is a fatal viral disease that can affect both animals and humans and is transmitted through bites from infected wildlife. Because of this risk, rabies vaccination is required by law and is considered a core vaccine for all dogs and cats.</p>',
      },
      {
        id: 'why_fvrcp',
        label: 'FVRCP (feline distemper)',
        items: FVRCP_ITEMS,
        html: '<p>FVRCP protects cats against three serious viral diseases: feline viral rhinotracheitis, calicivirus, and panleukopenia. Because these infections are common and can cause severe illness, Vet At Your Door considers FVRCP a core vaccine for all indoor and outdoor cats.</p>',
      },
      {
        id: 'why_dapp',
        label: 'DAPP (canine distemper)',
        items: DAPP_ITEMS,
        html: '<p>DAPP protects dogs against distemper, adenovirus, parainfluenza, and parvovirus. Parvovirus in particular is widespread in the environment and often fatal in unvaccinated dogs, so Vet At Your Door considers DAPP a core vaccine for every dog.</p>',
      },
      {
        id: 'why_lyme',
        label: 'Lyme (crLyme)',
        items: [LYME_INITIAL, ...LYME_EQUIVALENTS],
        html: '<p>Lyme disease is extremely common in our area due to the high number of ticks. Because of this risk, Vet At Your Door considers the Lyme vaccine a core vaccine for dogs to help prevent painful joint disease and rare but serious kidney complications.</p>',
      },
      {
        id: 'why_lepto',
        label: 'Leptospirosis',
        items: [LEPTO_INITIAL, ...LEPTO_EQUIVALENTS],
        html: '<p>Leptospirosis is a serious bacterial infection that dogs can contract from water contaminated with wildlife urine, such as puddles or streams. Because it can be life-threatening for dogs and can also spread to humans, Vet At Your Door considers the Leptospirosis vaccine a core vaccine for dogs.</p>',
      },
      {
        id: 'why_bordetella',
        label: 'Bordetella',
        items: [BORDETELLA, ...BORDETELLA_EQUIVALENTS],
        html: '<p>Bordetella ("kennel cough") is a contagious respiratory infection that spreads easily anywhere dogs gather, such as boarding facilities, daycare, grooming, or training classes. This vaccine helps protect dogs who have contact with other dogs and reduces the risk of infection.</p>',
      },
      {
        id: 'why_felv',
        label: 'FeLV (Leukemia)',
        items: [FELV_INITIAL, ...FELV_EQUIVALENTS],
        html: "<p>Feline Leukemia Virus (FeLV) is a contagious virus that weakens a cat's immune system and can lead to serious illness. We recommend this vaccine for all cats under one year of age, as well as adult cats that go outdoors or live with cats who have outdoor exposure.</p>",
      },
      {
        id: 'why_4dx',
        label: 'Heartworm / tick screen (4Dx)',
        items: [CANINE_4DX],
        html: '<p>The 4Dx test screens for heartworm disease and common tick-borne infections such as Lyme, Anaplasma, and Ehrlichia. Because heartworm disease can be serious and prevention medications require a current negative heartworm test for safe prescribing, we recommend this screening annually.</p>',
      },
      {
        id: 'why_fecal',
        label: 'Fecal screening',
        items: [FECAL_O_P, FECAL_COMP],
        html: '<p>A fecal test screens for intestinal parasites such as roundworms, hookworms, whipworms, and giardia. Because these parasites are common and some can spread to people, we recommend periodic screening to detect infections early and treat them appropriately.</p>',
      },
    ],
    defaultDeclineCautionHtml:
      '<p>If you would rather skip this today, just let the doctor know at the visit.</p>',
  });
}
