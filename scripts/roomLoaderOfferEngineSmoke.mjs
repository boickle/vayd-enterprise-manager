/**
 * Smoke: the Room Loader offer engine drives every lab / vaccine / add-on decision from
 * practice settings instead of the catalog codes that used to be hardcoded in the form.
 *
 * Covers the rules Deirdre specified: age+species panel asks, choose-one panels, the
 * sub-asks that appear when a panel is crossed out, the estimate lines a panel replaces
 * when it is accepted, universal add-ons, species/age gated offers with decline re-offer,
 * and the outdoor-access pitch.
 *
 * Run: node scripts/roomLoaderOfferEngineSmoke.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DateTime } = require('luxon');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failures = 0;
let checks = 0;

function assert(cond, msg) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.error(`  ✗ ${msg}`);
    return;
  }
  console.log(`  ✓ ${msg}`);
}

function section(name) {
  console.log(`\n${name}`);
}

/**
 * The engine is TypeScript, so compile it (and the config module it imports) to a temp
 * dir and import the JS. This exercises the real implementation rather than a mirror.
 */
function buildEngine() {
  // Build inside the repo so `luxon` still resolves from node_modules at import time.
  const outDir = fs.mkdtempSync(path.join(root, 'node_modules', '.cache', 'rl-engine-'));
  execFileSync(
    path.join(root, 'node_modules', '.bin', 'tsc'),
    [
      path.join(root, 'src/utils/roomLoaderOfferEngine.ts'),
      path.join(root, 'src/utils/roomLoaderMembershipAlign.ts'),
      path.join(root, 'src/utils/roomLoaderConfigSeed.ts'),
      path.join(root, 'src/pages/roomLoader/roomLoaderPlanContext.ts'),
      '--outDir',
      outDir,
      '--module',
      'commonjs',
      '--target',
      'es2022',
      '--moduleResolution',
      'node',
      '--skipLibCheck',
      // Emit only. The plan-context module reaches into `src/api` for a type, and those
      // modules read `import.meta.env`, which will not type-check under commonjs. Types
      // are covered by the repo-wide `tsc --noEmit`; this build just needs runnable JS.
      '--noCheck',
      '--rootDir',
      path.join(root, 'src'),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  return outDir;
}

const outDir = buildEngine();
const engine = require(path.join(outDir, 'utils/roomLoaderOfferEngine.js'));
const configMod = require(path.join(outDir, 'utils/roomLoaderConfigTypes.js'));
const planContext = require(
  path.join(outDir, 'pages/roomLoader/roomLoaderPlanContext.js'),
);

const {
  ageWindowMatches,
  dedupeOffers,
  estimateLinesReplacedByPanel,
  gatedOffersFor,
  historyGateAllows,
  panelSubAsksFor,
  patientAgeMonths,
  resolvePetPlan,
  selectPanelRules,
  medicalConcernPanelRules,
  speciesMatches,
  universalOffersFor,
} = engine;
const { emptyRoomLoaderConfig, emptyHistoryGate, normalizeRoomLoaderConfig } = configMod;

const NOW = DateTime.fromISO('2026-10-02T12:00:00', { zone: 'America/New_York' });

function ref(itemType, itemId, name, code) {
  return { itemType, itemId, name, code: code ?? null };
}

function ctx(overrides = {}) {
  return {
    species: 'dog',
    ageMonths: 48,
    history: [],
    reminders: [],
    estimateLines: [],
    outdoorAccess: null,
    medicalConcern: false,
    asOf: NOW,
    ...overrides,
  };
}

/* ---------------------------------------------------------------- age + species ---- */

section('Age and species matching');

assert(patientAgeMonths('2020-10-02', NOW) === 72, 'a pet born six years ago reads as 72 months');
assert(patientAgeMonths(null, NOW) === null, 'a missing birthdate gives no age');
assert(patientAgeMonths('2030-01-01', NOW) === null, 'a future birthdate is rejected');

assert(ageWindowMatches({ minMonths: 0, maxMonths: 6 }, 3), '3mo falls in the 0-6mo window');
assert(!ageWindowMatches({ minMonths: 0, maxMonths: 6 }, 6), '6mo is excluded by an exclusive max');
assert(ageWindowMatches({ minMonths: 6, maxMonths: 84 }, 6), '6mo starts the 6mo-7yr window');
assert(ageWindowMatches({ minMonths: 84, maxMonths: null }, 120), '10yr falls in the 7yr+ window');
assert(
  ageWindowMatches({ minMonths: 0, maxMonths: null }, null),
  'an unbounded window still applies when we have no birthdate',
);
assert(
  !ageWindowMatches({ minMonths: 84, maxMonths: null }, null),
  'an age-bounded rule is skipped when we have no birthdate',
);

assert(speciesMatches('any', 'cat'), 'an any-species rule matches a cat');
assert(speciesMatches('dog', 'dog'), 'a dog rule matches a dog');
assert(!speciesMatches('dog', 'cat'), 'a dog rule does not match a cat');
assert(speciesMatches(['any'], 'rabbit'), 'All species matches a rabbit');
assert(speciesMatches(['dog', 'rabbit'], 'rabbit'), 'a multi-species rule matches a rabbit');
assert(speciesMatches(['dog', 'rabbit'], 'dog'), 'a multi-species rule matches a dog');
assert(!speciesMatches(['dog', 'rabbit'], 'cat'), 'a dog+rabbit rule does not match a cat');

/* ------------------------------------------------------------------- panel rules ---- */

section('Panel rules by age and species (settings item 1)');

const fecalItem = ref('lab', 101, 'Fecal w/ Giardia', 'FIL24639');
const fourDxItem = ref('lab', 102, '4Dx', 'F4DX');
const earlyDetection = ref('lab', 103, 'Early Detection Panel - Canine', 'FIL48719999');
const seniorChem = ref('lab', 104, 'Senior Screen chem', 'FIL8659999');
const extendedPanel = ref('lab', 105, 'Extended Comprehensive Panel', 'FIL25659999');

function panelOption(id, item, extras = {}) {
  return {
    id,
    item,
    displayName: item.name,
    descriptionHtml: '',
    imageUrl: null,
    imageCaption: '',
    replacesItems: [],
    subAsks: [],
    ...extras,
  };
}

const config = normalizeRoomLoaderConfig({
  ...emptyRoomLoaderConfig(),
  panelRules: [
    {
      id: 'r_puppy_fecal',
      label: 'Puppy/kitten fecal',
      enabled: true,
      species: 'any',
      age: { minMonths: 0, maxMonths: 6 },
      introHtml: '',
      sortOrder: 0,
      options: [panelOption('o_fecal', fecalItem)],
    },
    {
      id: 'r_early_detection',
      label: 'Adult dog early detection',
      enabled: true,
      species: 'dog',
      age: { minMonths: 6, maxMonths: 84 },
      introHtml: '',
      sortOrder: 1,
      options: [
        panelOption('o_ed', earlyDetection, {
          replacesItems: [fourDxItem, fecalItem],
          subAsks: [
            {
              id: 's_4dx',
              item: fourDxItem,
              displayName: '4Dx',
              cautionHtml: '<p>Heartworm and tick disease screening.</p>',
              requiresOutdoorAccess: false,
              history: { ...emptyHistoryGate(), suppressIfDoneWithinMonths: 10 },
            },
            {
              id: 's_fecal',
              item: fecalItem,
              displayName: 'Fecal w/ Giardia',
              cautionHtml: '<p>Intestinal parasites.</p>',
              requiresOutdoorAccess: false,
              history: { ...emptyHistoryGate(), suppressIfDoneWithinMonths: 10 },
            },
          ],
        }),
      ],
    },
    {
      id: 'r_senior',
      label: 'Senior choice',
      enabled: true,
      species: 'dog',
      age: { minMonths: 84, maxMonths: null },
      introHtml: '<p>Pick the panel you prefer.</p>',
      sortOrder: 2,
      options: [panelOption('o_chem', seniorChem), panelOption('o_ext', extendedPanel)],
    },
    {
      id: 'r_disabled',
      label: 'Turned off',
      enabled: false,
      species: 'any',
      age: { minMonths: 0, maxMonths: null },
      introHtml: '',
      sortOrder: 3,
      options: [panelOption('o_off', fecalItem)],
    },
  ],
});

const puppyRules = selectPanelRules(config, ctx({ ageMonths: 3 }));
assert(puppyRules.length === 1 && puppyRules[0].id === 'r_puppy_fecal', 'a 3mo puppy is asked only about the fecal');

const adultRules = selectPanelRules(config, ctx({ ageMonths: 48 }));
assert(
  adultRules.length === 1 && adultRules[0].id === 'r_early_detection',
  'a 4yr dog is asked only about early detection',
);

const seniorRules = selectPanelRules(config, ctx({ ageMonths: 120 }));
assert(seniorRules.length === 1 && seniorRules[0].id === 'r_senior', 'a 10yr dog gets the senior rule');
assert(seniorRules[0].options.length === 2, 'the senior rule offers a choice of two panels');

const seniorCatRules = selectPanelRules(config, ctx({ species: 'cat', ageMonths: 120 }));
assert(seniorCatRules.length === 0, 'a senior cat does not get the dog-only senior rule');

const kittenRules = selectPanelRules(config, ctx({ species: 'cat', ageMonths: 3 }));
assert(kittenRules.length === 1, 'an any-species rule still reaches a kitten');

assert(
  selectPanelRules(config, ctx({ ageMonths: 48 })).every((r) => r.id !== 'r_disabled'),
  'a disabled rule is never asked',
);

const sickPuppy = selectPanelRules(config, ctx({ ageMonths: 3, medicalConcern: true }));
assert(
  sickPuppy.length === 1 && sickPuppy[0].id === 'r_senior' && sickPuppy[0].options.length === 2,
  'a puppy whose visit warrants labs is offered the two-panel choice, not the fecal',
);

const sickAdult = selectPanelRules(config, ctx({ ageMonths: 48, medicalConcern: true }));
assert(
  sickAdult.length === 1 && sickAdult[0].id === 'r_senior',
  'an adult whose visit warrants labs is offered the two-panel choice, not early detection',
);

const sickSenior = selectPanelRules(config, ctx({ ageMonths: 120, medicalConcern: true }));
assert(
  sickSenior.length === 1 && sickSenior[0].id === 'r_senior',
  'a senior whose visit warrants labs still gets the two-panel choice',
);

assert(
  medicalConcernPanelRules(config, ctx({ species: 'cat', ageMonths: 3, medicalConcern: true }))
    .length === 0,
  'a kitten has no two-panel rule, so medical-concern selection stays empty until one exists',
);

const sickKittenFallback = selectPanelRules(
  config,
  ctx({ species: 'cat', ageMonths: 3, medicalConcern: true })
);
assert(
  sickKittenFallback.length === 1 && sickKittenFallback[0].id === 'r_puppy_fecal',
  'without a two-panel rule, a medical-concern kitten still gets the age-matched fecal',
);

const noOverwrite = {
  ...config,
  medicalConcern: { ...config.medicalConcern, overwriteAgeBasedPanels: false },
};
assert(
  selectPanelRules(noOverwrite, ctx({ ageMonths: 3, medicalConcern: true }))[0]?.id ===
    'r_puppy_fecal',
  'turning off overwrite keeps the age-based fecal on a medical-concern puppy',
);
assert(
  selectPanelRules(noOverwrite, ctx({ ageMonths: 48, medicalConcern: true }))[0]?.id ===
    'r_early_detection',
  'turning off overwrite keeps early detection on a medical-concern adult',
);

/* --------------------------------------------------------------------- sub-asks ---- */

section('Sub-asks when a panel is crossed out (settings item 2a)');

const edOption = config.panelRules.find((r) => r.id === 'r_early_detection').options[0];

const allSubAsks = panelSubAsksFor(edOption, ctx());
assert(allSubAsks.length === 2, 'declining early detection offers the 4Dx and the fecal separately');

const recentFourDx = panelSubAsksFor(
  edOption,
  ctx({ history: [{ itemType: 'lab', itemId: 102, date: NOW.minus({ months: 4 }).toISO() }] }),
);
assert(
  recentFourDx.length === 1 && recentFourDx[0].id === 's_fecal',
  'a 4Dx four months ago suppresses that sub-ask but not the fecal',
);

const declinedNotCounted = panelSubAsksFor(
  edOption,
  ctx({
    history: [{ itemType: 'lab', itemId: 102, date: NOW.minus({ months: 4 }).toISO(), declined: true }],
  }),
);
assert(
  declinedNotCounted.length === 1,
  'a previously DECLINED 4Dx does not count as having been done, and stays hidden by default',
);

const outdoorOnly = panelSubAsksFor(
  {
    ...edOption,
    subAsks: [{ ...edOption.subAsks[0], requiresOutdoorAccess: true }],
  },
  ctx({ outdoorAccess: false }),
);
assert(outdoorOnly.length === 0, 'an outdoor-only sub-ask is hidden for an indoor pet');

const outdoorYes = panelSubAsksFor(
  {
    ...edOption,
    subAsks: [{ ...edOption.subAsks[0], requiresOutdoorAccess: true }],
  },
  ctx({ outdoorAccess: true }),
);
assert(outdoorYes.length === 1, 'an outdoor-only sub-ask appears once the owner answers yes');

const reminderFarOut = panelSubAsksFor(
  {
    ...edOption,
    subAsks: [
      {
        ...edOption.subAsks[0],
        history: { ...emptyHistoryGate(), suppressIfReminderDueBeyondMonths: 6 },
      },
    ],
  },
  ctx({ reminders: [{ itemType: 'lab', itemId: 102, dueDate: NOW.plus({ months: 9 }).toISO() }] }),
);
assert(reminderFarOut.length === 0, 'a sub-ask is skipped when its reminder is not due for nine months');

/* ------------------------------------------------------- estimate lines replaced ---- */

section('Estimate lines removed when a panel is accepted (settings item 2b)');

const staffEstimate = [
  { itemType: 'lab', itemId: 102, code: 'F4DX' },
  { itemType: 'lab', itemId: 101, code: 'FIL24639' },
  { itemType: 'procedure', itemId: 900, code: 'EXAM' },
];

const replaced = estimateLinesReplacedByPanel(edOption, staffEstimate);
assert(replaced.length === 2, 'accepting early detection strikes the separate 4Dx and fecal lines');
assert(
  !replaced.some((l) => l.code === 'EXAM'),
  'the exam is left alone because the panel does not replace it',
);
assert(
  estimateLinesReplacedByPanel(panelOption('o_none', seniorChem), staffEstimate).length === 0,
  'a panel with no replacements strikes nothing',
);

const byCodeOnly = estimateLinesReplacedByPanel(edOption, [{ code: 'f4dx' }]);
assert(byCodeOnly.length === 1, 'matching falls back to the catalog code, case-insensitively');

/* -------------------------------------------------------------- universal offers ---- */

section('Items offered to everyone (settings item 3)');

const pedicureDog = ref('procedure', 201, 'Pedicure - Dog', 'PEDDOG');
const pedicureCat = ref('procedure', 202, 'Pedicure - Cat', 'PEDCAT');
const microchip = ref('inventory', 203, 'HomeAgain Microchip', 'CHIP');
const analGlands = ref('procedure', 204, 'Anal Gland Expression', 'AGE');

const offersConfig = normalizeRoomLoaderConfig({
  ...emptyRoomLoaderConfig(),
  universalOffers: [
    {
      id: 'u_ped',
      enabled: true,
      displayName: 'Nail trim / pedicure',
      species: 'any',
      descriptionHtml: '',
      item: null,
      itemBySpecies: { dog: pedicureDog, cat: pedicureCat },
      sortOrder: 0,
    },
    {
      id: 'u_chip',
      enabled: true,
      displayName: 'Microchip',
      species: 'any',
      descriptionHtml: '',
      item: microchip,
      itemBySpecies: { dog: null, cat: null },
      sortOrder: 1,
    },
    {
      id: 'u_glands',
      enabled: true,
      displayName: 'Anal gland expression',
      species: 'dog',
      descriptionHtml: '',
      item: analGlands,
      itemBySpecies: { dog: null, cat: null },
      sortOrder: 2,
    },
  ],
});

const dogOffers = universalOffersFor(offersConfig, ctx({ species: 'dog' }));
assert(dogOffers.length === 3, 'a dog is offered the pedicure, microchip and gland expression');
assert(dogOffers[0].item.itemId === 201, 'the dog gets the dog pedicure');

const catOffers = universalOffersFor(offersConfig, ctx({ species: 'cat' }));
assert(catOffers.length === 2, 'a cat skips the dog-only gland expression');
assert(catOffers[0].item.itemId === 202, 'the cat gets the cat pedicure');

const alreadyEstimated = universalOffersFor(
  offersConfig,
  ctx({ species: 'dog', estimateLines: [{ itemType: 'inventory', itemId: 203 }] }),
);
assert(
  !alreadyEstimated.some((o) => o.item.itemId === 203),
  'an add-on staff already put on the estimate is not offered a second time',
);

/* ------------------------------------------------------------------ gated offers ---- */

section('Species / age / history gated offers (settings items 4 and 5)');

const lepto = ref('inventory', 301, 'Leptospirosis Vaccine', 'LEPTO');

function leptoConfig(gate) {
  return normalizeRoomLoaderConfig({
    ...emptyRoomLoaderConfig(),
    gatedOffers: [
      {
        id: 'g_lepto',
        enabled: true,
        displayName: 'Leptospirosis vaccine',
        species: 'dog',
        item: lepto,
        age: { minMonths: 3, maxMonths: null },
        history: gate,
        requiresOutdoorAccess: false,
        descriptionHtml: '',
        cautionHtml: '<p>Leptospirosis is a bacteria spread by wild animals through urine.</p>',
        sortOrder: 0,
      },
    ],
  });
}

const plainGate = { ...emptyHistoryGate(), suppressIfDoneWithinMonths: 15 };

assert(gatedOffersFor(leptoConfig(plainGate), ctx()).length === 1, 'lepto is offered to an adult dog');
assert(
  gatedOffersFor(leptoConfig(plainGate), ctx({ species: 'cat' })).length === 0,
  'lepto is not offered to a cat',
);
assert(
  gatedOffersFor(leptoConfig(plainGate), ctx({ ageMonths: 2 })).length === 0,
  'lepto is not offered below the minimum age',
);
assert(
  gatedOffersFor(
    leptoConfig(plainGate),
    ctx({ history: [{ itemType: 'inventory', itemId: 301, date: NOW.minus({ months: 10 }).toISO() }] }),
  ).length === 0,
  'lepto given 10 months ago is inside the 15-month window, so it is not re-offered',
);
assert(
  gatedOffersFor(
    leptoConfig(plainGate),
    ctx({ history: [{ itemType: 'inventory', itemId: 301, date: NOW.minus({ months: 17 }).toISO() }] }),
  ).length === 1,
  'lepto given 17 months ago is due again',
);

const declinedHistory = [
  { itemType: 'inventory', itemId: 301, date: NOW.minus({ months: 12 }).toISO(), declined: true },
];
assert(
  gatedOffersFor(leptoConfig(plainGate), ctx({ history: declinedHistory })).length === 0,
  'a previously declined vaccine stays hidden when the practice has not opted in to re-asking',
);

const reofferGate = {
  ...emptyHistoryGate(),
  suppressIfDoneWithinMonths: 15,
  showEvenIfPreviouslyDeclined: true,
  reofferDeclinedAfterMonths: 11,
};
assert(
  gatedOffersFor(leptoConfig(reofferGate), ctx({ history: declinedHistory })).length === 1,
  'with "show even if declined" and an 11-month wait, a 12-month-old decline is offered again',
);
assert(
  gatedOffersFor(
    leptoConfig(reofferGate),
    ctx({
      history: [
        { itemType: 'inventory', itemId: 301, date: NOW.minus({ months: 4 }).toISO(), declined: true },
      ],
    }),
  ).length === 0,
  'a 4-month-old decline is still inside the 11-month wait, so it stays hidden',
);

assert(
  gatedOffersFor(leptoConfig(plainGate), ctx())[0].cautionHtml.includes('wild animals'),
  'the configured caution copy rides along with the offer',
);

const fallbackCaution = normalizeRoomLoaderConfig({
  ...emptyRoomLoaderConfig(),
  defaultDeclineCautionHtml: '<p>Please talk to your vet before skipping this.</p>',
  gatedOffers: [
    {
      id: 'g_blank',
      enabled: true,
      displayName: 'Something',
      species: 'any',
      item: lepto,
      age: { minMonths: 0, maxMonths: null },
      history: emptyHistoryGate(),
      requiresOutdoorAccess: false,
      descriptionHtml: '',
      cautionHtml: '',
      sortOrder: 0,
    },
  ],
});
assert(
  gatedOffersFor(fallbackCaution, ctx())[0].cautionHtml.includes('talk to your vet'),
  'an offer with no caution of its own falls back to the practice default',
);

/* ---------------------------------------------------------------------- outdoor ---- */

section('Outdoor question and its pitch (settings item 6)');

const felv = ref('inventory', 401, 'FeLV Vaccine', 'FELV1');
const outdoorConfig = normalizeRoomLoaderConfig({
  ...emptyRoomLoaderConfig(),
  outdoor: {
    enabled: true,
    species: 'cat',
    questionText: 'Does {petName} go outdoors?',
    required: true,
    pitchHtml: '<p>Outdoor cats are exposed to feline leukemia.</p>',
    pitchItem: felv,
    pitchDisplayName: 'Feline leukemia vaccine',
    pitchCautionHtml: '<p>FeLV is spread cat to cat.</p>',
    history: { ...emptyHistoryGate(), suppressIfDoneWithinMonths: 24 },
  },
});

const indoorCat = resolvePetPlan(outdoorConfig, ctx({ species: 'cat', outdoorAccess: false }));
assert(indoorCat.askOutdoorAccess, 'cats are asked the outdoor question');
assert(indoorCat.outdoorPitch === null, 'an indoor cat gets no FeLV pitch');

const outdoorCat = resolvePetPlan(outdoorConfig, ctx({ species: 'cat', outdoorAccess: true }));
assert(outdoorCat.outdoorPitch?.item.itemId === 401, 'an outdoor cat is pitched the configured FeLV item');
assert(
  outdoorCat.outdoorPitch.cautionHtml.includes('cat to cat'),
  'the pitch carries its own caution copy',
);

const dogPlan = resolvePetPlan(outdoorConfig, ctx({ species: 'dog' }));
assert(!dogPlan.askOutdoorAccess, 'dogs are not asked a cat-only outdoor question');

const vaccinatedOutdoorCat = resolvePetPlan(
  outdoorConfig,
  ctx({
    species: 'cat',
    outdoorAccess: true,
    history: [{ itemType: 'inventory', itemId: 401, date: NOW.minus({ months: 8 }).toISO() }],
  }),
);
assert(
  vaccinatedOutdoorCat.outdoorPitch === null,
  'a cat vaccinated 8 months ago is not pitched again inside the 24-month window',
);

/* -------------------------------------------------------------- medical concern ---- */

section('Medical concern panels (settings item 7)');

const mcConfig = normalizeRoomLoaderConfig({
  ...emptyRoomLoaderConfig(),
  medicalConcern: {
    enabled: true,
    species: 'any',
    introHtml: '<p>Because you mentioned a concern…</p>',
    options: [panelOption('o_mc', seniorChem)],
  },
});

assert(
  resolvePetPlan(mcConfig, ctx({ medicalConcern: true })).medicalConcernOptions.length === 1,
  'a flagged medical concern asks about the configured panel',
);
assert(
  resolvePetPlan(mcConfig, ctx({ medicalConcern: false })).medicalConcernOptions.length === 0,
  'no concern means no extra panel',
);

/* ------------------------------------------------------------------------ misc ---- */

section('Shared behaviour');

assert(
  historyGateAllows(emptyHistoryGate(), lepto, ctx()),
  'an empty gate allows the offer through',
);

const deduped = dedupeOffers(
  [{ id: 'a', displayName: 'A', descriptionHtml: '', cautionHtml: '', item: lepto }],
  [{ id: 'b', displayName: 'B', descriptionHtml: '', cautionHtml: '', item: lepto }],
);
assert(deduped.length === 1, 'the same catalog item is never offered twice on one pet');

const emptyPlan = resolvePetPlan(emptyRoomLoaderConfig(), ctx());
assert(
  emptyPlan.panelRules.length === 0 && emptyPlan.universalOffers.length === 0,
  'an unconfigured practice asks nothing extra rather than erroring',
);

/* ------------------------------------------------------- seeded VAYD vaccines ---- */

section('VAYD starter vaccine offers');

const seed = require(path.join(outDir, 'utils/roomLoaderConfigSeed.js'));
const vaydConfig = seed.vaydRoomLoaderConfigSeed();

/** Offer ids a pet of this description would actually be shown. */
function seededVaccines(overrides) {
  return gatedOffersFor(vaydConfig, ctx(overrides)).map((o) => o.id);
}

const adultDogVax = seededVaccines({ species: 'dog', ageMonths: 48 });
assert(
  ['vax_lyme', 'vax_lepto', 'vax_bordetella'].every((id) => adultDogVax.includes(id)),
  'an adult dog is offered Lyme, Lepto and Bordetella',
);
assert(!adultDogVax.includes('vax_felv_kitten'), 'a dog is never offered the kitten FeLV vaccine');

assert(
  seededVaccines({ species: 'cat', ageMonths: 6 }).join() === 'vax_felv_kitten',
  'a 6-month kitten is offered FeLV and none of the dog vaccines',
);
assert(
  seededVaccines({ species: 'cat', ageMonths: 36 }).length === 0,
  'an adult cat ages out of the kitten FeLV offer',
);

const lymeOffer = vaydConfig.gatedOffers.find((o) => o.id === 'vax_lyme');
const lymeInitial = lymeOffer.item;
const lymeAnnual = lymeOffer.equivalentItems[0];
assert(lymeAnnual != null, 'the Lyme offer lists at least one equivalent product form');

assert(
  !seededVaccines({
    species: 'dog',
    ageMonths: 48,
    estimateLines: [{ itemType: lymeInitial.itemType, itemId: lymeInitial.itemId }],
  }).includes('vax_lyme'),
  'Lyme already on the estimate is not offered again',
);
assert(
  !seededVaccines({
    species: 'dog',
    ageMonths: 48,
    estimateLines: [{ itemType: lymeAnnual.itemType, itemId: lymeAnnual.itemId }],
  }).includes('vax_lyme'),
  'the annual Lyme product on the estimate also suppresses the offer',
);
assert(
  !seededVaccines({
    species: 'dog',
    ageMonths: 48,
    history: [
      { itemType: lymeAnnual.itemType, itemId: lymeAnnual.itemId, date: NOW.minus({ months: 5 }).toISO() },
    ],
  }).includes('vax_lyme'),
  'an equivalent Lyme product given 5 months ago satisfies the 15-month gate',
);
assert(
  seededVaccines({
    species: 'dog',
    ageMonths: 48,
    history: [
      { itemType: lymeAnnual.itemType, itemId: lymeAnnual.itemId, date: NOW.minus({ months: 20 }).toISO() },
    ],
  }).includes('vax_lyme'),
  'Lyme given 20 months ago is due again',
);
assert(
  !seededVaccines({
    species: 'dog',
    ageMonths: 48,
    reminders: [
      { itemType: lymeInitial.itemType, itemId: lymeInitial.itemId, dueDate: NOW.plus({ months: 7 }).toISO() },
    ],
  }).includes('vax_lyme'),
  'a Lyme reminder not due for another seven months keeps the offer off this visit',
);
assert(
  seededVaccines({
    species: 'dog',
    ageMonths: 48,
    history: [
      { itemType: lymeInitial.itemType, itemId: lymeInitial.itemId, date: NOW.minus({ months: 18 }).toISO(), declined: true },
    ],
  }).includes('vax_lyme'),
  'a declined Lyme is asked again at the next visit',
);

section('VAYD starter questions about the estimate');

const { itemQuestionsFor } = engine;

/** Question ids this pet would be asked, given what staff put on the estimate. */
function seededAsks(overrides) {
  return itemQuestionsFor(vaydConfig, ctx(overrides)).map((q) => q.id);
}

const lymeOnEstimate = [{ itemType: lymeInitial.itemType, itemId: lymeInitial.itemId }];

assert(
  seededAsks({ species: 'dog', estimateLines: lymeOnEstimate }).includes('ask_crlyme_booster'),
  'a dog getting its first crLyme is asked about booking the booster',
);
assert(
  seededAsks({ species: 'dog', estimateLines: [] }).length === 0,
  'the booster question stays hidden when crLyme is not on the estimate',
);
assert(
  !seededAsks({
    species: 'dog',
    estimateLines: lymeOnEstimate,
    history: [
      { itemType: lymeAnnual.itemType, itemId: lymeAnnual.itemId, date: NOW.minus({ years: 2 }).toISO() },
    ],
  }).includes('ask_crlyme_booster'),
  'a dog that had any Lyme vaccine before is not asked — that booster is required, not optional',
);
assert(
  seededAsks({
    species: 'dog',
    estimateLines: lymeOnEstimate,
    history: [
      { itemType: lymeInitial.itemType, itemId: lymeInitial.itemId, date: NOW.minus({ years: 2 }).toISO(), declined: true },
    ],
  }).includes('ask_crlyme_booster'),
  'a past DECLINE of Lyme does not count as having had it, so the booster is still asked',
);
assert(
  !seededAsks({ species: 'cat', estimateLines: lymeOnEstimate }).includes('ask_crlyme_booster'),
  'the crLyme booster question is never asked about a cat',
);

const rabiesQuestion = vaydConfig.itemQuestions.find((q) => q.id === 'ask_cat_rabies_form');
const felineRabies = rabiesQuestion.triggerItems.find((r) => r.code === 'RABIESPUREVAX1');
const rabiesOnEstimate = [{ itemType: felineRabies.itemType, itemId: felineRabies.itemId }];

assert(
  seededAsks({ species: 'cat', estimateLines: rabiesOnEstimate }).includes('ask_cat_rabies_form'),
  'a cat due for rabies is asked which rabies vaccine the owner prefers',
);
assert(
  !seededAsks({ species: 'dog', estimateLines: rabiesOnEstimate }).includes('ask_cat_rabies_form'),
  'a dog is not asked the cat rabies preference',
);
assert(
  !seededAsks({ species: 'cat', estimateLines: [] }).includes('ask_cat_rabies_form'),
  'a cat with no rabies on the estimate is not asked',
);
assert(
  seededAsks({
    species: 'cat',
    estimateLines: rabiesOnEstimate,
    history: [
      { itemType: felineRabies.itemType, itemId: felineRabies.itemId, date: NOW.minus({ years: 3 }).toISO() },
    ],
  }).includes('ask_cat_rabies_form'),
  'a cat vaccinated before is still asked, because the preference applies every time',
);
assert(
  rabiesQuestion.choices.map((c) => c.id).join() === '1year,3year,no',
  'the rabies question offers 1 year, 3 year and a decline',
);
assert(
  vaydConfig.itemQuestions.every((q) => q.required && q.choices.length >= 2),
  'every starter question is required and has at least two answers',
);

section('VAYD starter "why we recommend" copy');

const reasonIds = vaydConfig.declineReasons.map((r) => r.id);
assert(
  ['why_rabies', 'why_fvrcp', 'why_lyme', 'why_lepto', 'why_bordetella'].every((id) =>
    reasonIds.includes(id),
  ),
  'the starter document explains Rabies, FVRCP, Lyme, Lepto and Bordetella',
);
assert(
  vaydConfig.declineReasons.every((r) => r.html.trim() !== '' && r.items.length > 0),
  'every explanation has copy and at least one catalog item to match on',
);

/* -------------------------------- membership age alignment ---------------- */

section('Membership age alignment');

const align = require(path.join(outDir, 'utils/roomLoaderMembershipAlign.js'));
const earlyDet = ref('lab', 953, 'Early Detection Canine', 'FIL48719999');
const seniorExt = ref('lab', 134, 'Senior Screen Canine', 'FIL25659999');
const fecalOnly = ref('lab', 139, 'Comprehensive Fecal', 'FIL24639');
const alignPlans = align.plansFromBundles([
  {
    id: 11,
    name: 'Foundations Dog',
    species: 'dog',
    maxAgeMonths: 96,
    groups: [{ items: [{ itemType: 'lab', catalogItemId: 953 }] }],
  },
  {
    id: 22,
    name: 'Golden Dog',
    species: 'dog',
    minAgeMonths: 96,
    groups: [{ items: [{ itemType: 'lab', catalogItemId: 134 }] }],
  },
]);

assert(align.formatPlanAge(alignPlans[1]).includes('8 years'), 'Golden is described as 8 years and older');
assert(
  align.coveringFamiliesForItem(earlyDet, alignPlans, 'dog').join() === 'foundations',
  'early detection is found on Foundations',
);
assert(
  align.coveringFamiliesForItem(seniorExt, alignPlans, 'dog').join() === 'golden',
  'senior screen is found on Golden',
);
assert(
  align.coveringFamiliesForItem(fecalOnly, alignPlans, 'dog').length === 0,
  'an item on no plan does not warn',
);
assert(
  align.mismatchesForRule({
    age: { minMonths: 6, maxMonths: 96 },
    alignPackageId: 11,
    plans: alignPlans,
  }).length === 0,
  'early detection asked 6 months to 8 years matches Foundations',
);
assert(
  align.mismatchesForRule({
    age: { minMonths: 0, maxMonths: 6 },
    alignPackageId: null,
    plans: alignPlans,
  }).length === 0,
  'a rule with no membership alignment does not warn',
);
assert(
  /stops at 7 years/.test(
    align.mismatchesForRule({
      age: { minMonths: 6, maxMonths: 84 },
      alignPackageId: 11,
      plans: alignPlans,
    })[0]?.message ?? '',
  ),
  'stopping early detection at 7 years warns about the 7–8 gap',
);
assert(
  /8 years/.test(
    align.mismatchesForRule({
      age: { minMonths: 6, maxMonths: null },
      alignPackageId: 11,
      plans: alignPlans,
    })[0]?.message ?? '',
  ),
  'asking early detection past the Foundations oldest age warns',
);
assert(
  /starts at 7 years/.test(
    align.mismatchesForRule({
      age: { minMonths: 84, maxMonths: null },
      alignPackageId: 22,
      plans: alignPlans,
    })[0]?.message ?? '',
  ),
  'asking senior screen from 7 years warns it starts before Golden',
);
assert(
  align.mismatchesForRule({
    age: { minMonths: 96, maxMonths: null },
    alignPackageId: 22,
    plans: alignPlans,
  }).length === 0,
  'senior screen asked from 8 years matches Golden',
);
assert(
  align.snapAgeToPlan({ minMonths: 6, maxMonths: 84 }, alignPlans[0]).maxMonths === 96,
  'matching Foundations sets the window end to that plan’s oldest age',
);
assert(
  align.snapAgeToPlan({ minMonths: 84, maxMonths: null }, alignPlans[1]).minMonths === 96,
  'matching Golden sets the window start to that plan’s youngest age',
);

section('reminder gate sees future reminders from the live list');

/*
 * Poppy's case. Staff send an estimate holding only what is due now, because the server
 * caps that snapshot at three months out. Her 4Dx and fecal are already on the books for
 * Aug 2027, and those rows only exist on the live `data.reminders` list. If the gate reads
 * the snapshot alone it sees no reminder and re-offers both screenings.
 */
const liveReminders = [
  {
    reminder: {
      id: 9001,
      description: 'Heartworm Tick Test',
      dueDate: '2027-08-04',
      patient: { id: 11363 },
    },
    itemType: 'lab',
    matchedItem: { id: 132, code: 'F4DX', name: 'Heartworm / Tick Test (4dx)' },
  },
  {
    reminder: {
      id: 9002,
      description: 'Stool Parasite Check - please have sample at visit',
      dueDate: '2027-08-04',
      patient: { id: 11363 },
    },
    itemType: 'lab',
    matchedItem: { id: 137, code: 'FIL5010', name: 'Fecal Ova & Parasites' },
  },
  {
    // Another pet in the household: must not gate Poppy's asks.
    reminder: {
      id: 9003,
      description: 'Heartworm Tick Test',
      dueDate: '2027-08-04',
      patient: { id: 12722 },
    },
    itemType: 'lab',
    matchedItem: { id: 132, code: 'F4DX' },
  },
];

const snapshotPatient = {
  patientId: 11363,
  reminders: [
    {
      reminderId: 7001,
      reminderText: 'Rabies Vaccination - 3 year',
      dueDate: '2026-08-01',
      item: { id: 3926, type: 'inventory', code: 'RABIES3' },
    },
  ],
};

const poppyReminders = planContext.remindersFromPatient(
  snapshotPatient,
  { reminders: liveReminders },
  11363,
);

assert(
  poppyReminders.length === 3,
  'snapshot reminder plus this pet’s two live reminders reach the engine',
);
assert(
  poppyReminders.filter((r) => r.itemId === 132).length === 1,
  'the sibling pet’s identical reminder is left out',
);

const gate = { ...emptyHistoryGate(), suppressIfReminderDueBeyondMonths: 6 };
const poppyCtx = {
  species: 'dog',
  ageMonths: 60,
  history: [],
  reminders: poppyReminders,
  estimateLines: [],
  outdoorAccess: null,
  medicalConcern: false,
  asOf: NOW,
};

assert(
  !historyGateAllows(gate, ref('lab', 132, 'Heartworm / Tick Test (4Dx)', 'F4DX'), poppyCtx),
  '4Dx is not re-offered when its reminder is due 10 months out',
);
assert(
  !historyGateAllows(gate, ref('lab', 137, 'Fecal Ova & Parasites', 'FIL5010'), poppyCtx),
  'fecal is not re-offered when its reminder is due 10 months out',
);
assert(
  historyGateAllows(gate, ref('lab', 992, 'Feline Triple Snap', 'FELINE3DX'), poppyCtx),
  'an item with no reminder of its own is still offered',
);

/* A reminder inside the window means it IS due at this visit, so keep asking. */
const soonCtx = {
  ...poppyCtx,
  reminders: planContext.remindersFromPatient(
    snapshotPatient,
    {
      reminders: [
        {
          reminder: { id: 9004, dueDate: '2026-11-15', patient: { id: 11363 } },
          itemType: 'lab',
          matchedItem: { id: 132, code: 'F4DX' },
        },
      ],
    },
    11363,
  ),
};
assert(
  historyGateAllows(gate, ref('lab', 132, '4Dx', 'F4DX'), soonCtx),
  'a reminder due inside the window still lets the ask through',
);

/* Reminder text the server could not match to a catalog item must not gate anything. */
const unmatchedCtx = {
  ...poppyCtx,
  reminders: planContext.remindersFromPatient(
    snapshotPatient,
    {
      reminders: [
        {
          reminder: { id: 9005, dueDate: '2027-08-04', patient: { id: 11363 } },
          itemType: 'lab',
          matchedItem: null,
        },
      ],
    },
    11363,
  ),
};
assert(
  historyGateAllows(gate, ref('lab', 132, '4Dx', 'F4DX'), unmatchedCtx),
  'an unmatched reminder gates nothing',
);

/* ------------------------------------------------- sample collection copy ---- */

section('How-to-collect boxes on the labs page');

const { sampleInstructionsFor } = engine;

/** Instruction ids a pet of this species sees after accepting these catalog items. */
function collectionCards(species, ...itemIds) {
  return sampleInstructionsFor(
    vaydConfig,
    { species },
    itemIds.map((itemId) => ({ itemType: 'lab', itemId })),
  ).map((row) => row.id);
}

assert(
  collectionCards('dog', 139).join() === 'sample_stool_dog',
  'a puppy fecal asks the owner for a stool sample and nothing else',
);
assert(
  collectionCards('dog', 953).join() === 'sample_stool_dog',
  'the canine early detection panel bundles a fecal, so the stool box shows',
);
assert(
  collectionCards('dog', 128).length === 0,
  'the standard senior screen (FIL8659999) asks the owner to collect nothing',
);
assert(
  collectionCards('dog', 134).join() === 'sample_stool_dog,sample_urine_dog',
  'the extended canine senior screen asks for both a stool and a urine sample',
);
assert(
  collectionCards('cat', 942).join() === 'sample_stool_cat,sample_urine_cat',
  'the extended feline senior screen asks for both, in the feline wording',
);
assert(
  collectionCards('cat', 134).length === 0,
  'a cat never sees the dog-only boxes',
);
assert(
  collectionCards('dog').length === 0,
  'a pet who accepted nothing is asked to collect nothing',
);

const catStool = vaydConfig.sampleInstructions.find((row) => row.id === 'sample_stool_cat');
assert(
  /litter box/i.test(catStool.bodyHtml),
  'the feline stool copy talks about the litter box',
);
assert(
  vaydConfig.sampleInstructions.every(
    (row) => row.heading.includes('{petName}') && row.bodyHtml.trim() !== '',
  ),
  'every starter box is addressed to the pet by name and has copy',
);

fs.rmSync(outDir, { recursive: true, force: true });

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
