/**
 * Smoke: Foundations + staff labs = Yes must offer Early Detection, not Senior Screen / 8659999.
 * Staff-scheduled senior screens on the visit (reminders) stay out of this recommendation strip.
 *
 * Thread: 1792595815.432059 (Deirdre follow-up)
 * Run: node scripts/foundationsLabsYesOffersEdpSmoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/pages/PublicRoomLoaderForm.tsx'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Foundations labs = Yes must branch to EDP, not blind 8659999.
assert(
  src.includes('foundationsNotGoldenMember') &&
    src.includes("code: 'FIL48119999'") &&
    src.includes("code: 'FIL48719999'") &&
    src.includes('With Foundations membership we recommend our Early Detection Panel'),
  'Foundations labs=Yes must recommend species Early Detection with membership copy'
);

assert(
  /if \(labWorkYes\) \{[\s\S]*?if \(foundationsNotGoldenMember\) \{[\s\S]*?FIL48119999[\s\S]*?\} else \{[\s\S]*?8659999/.test(
    src
  ),
  'labWorkYes must offer EDP for Foundations and Senior Screen (8659999) only for non-Foundations'
);

// Do not strip EDP when Foundations + labs = Yes
assert(
  src.includes('if (labWorkYes && !foundationsNotGoldenMember)') &&
    src.includes('// Foundations labs = Yes keeps Early Detection'),
  'EDP strip on labs=Yes must skip Foundations members'
);

// Recommendation strip for Foundations must not require labs=No (always strip senior *offers*)
assert(
  src.includes('if (foundationsNotGoldenMember)') &&
    src.includes('stripSeniorLabRecommendationCodes(recs)'),
  'Foundations must strip Senior Screen recommendation codes regardless of labs Yes/No'
);

// Visit-list early-detection helper still gated on labs=No so reminder senior screens stay when labs=Yes
assert(
  /function roomLoaderFoundationsUsesEarlyDetectionOverSenior\([\s\S]*?!publicFormPetLabWorkConcernYes/.test(src),
  'Visit-row Foundations→EDP suppression must still require labs=No (preserve staff senior reminders when labs=Yes)'
);

console.log('foundationsLabsYesOffersEdpSmoke checks passed');
