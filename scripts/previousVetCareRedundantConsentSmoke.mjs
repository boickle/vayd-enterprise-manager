/**
 * Smoke: previous-vet consent fields should not double up as Yes + Yes
 * when the client chose "Please request them" (recordsDelivery=request).
 *
 * Bug: Julia Hussey auto-book (Slack #bugs-scout 1791983694.574859) showed
 * Previous Practices + Okay to Contact Previous Vets: Yes + May We Ask for Records: Yes.
 *
 * Run: node scripts/previousVetCareRedundantConsentSmoke.mjs
 *
 * Mirrors:
 * - src/pages/AppointmentRequestForm.tsx payload okayToContactPreviousVets
 * - src/utils/appointmentRequestDetailDisplay.ts veterinaryHistory rows
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function pickStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function pickYesNo(v) {
  const s = pickStr(v);
  if (s === 'Yes' || s === 'No') return s;
  return null;
}

/** Mirror of AppointmentRequestForm submit payload consent fields. */
function buildVetHistoryPayload({
  isLoggedIn,
  recordsDelivery = '',
  okayToContactPreviousVets = '',
  okayToContactPreviousVetsExisting = '',
  mayWeAskForRecords = '',
}) {
  const okayToContactPreviousVetsOut = (() => {
    const explicit =
      okayToContactPreviousVets || okayToContactPreviousVetsExisting || '';
    if (explicit === 'Yes' || explicit === 'No') return explicit;
    if (recordsDelivery === 'request') return undefined;
    if (!isLoggedIn) return 'Yes';
    return undefined;
  })();

  const mayWeAskForRecordsOut =
    recordsDelivery === 'request' ? 'Yes' : mayWeAskForRecords || undefined;

  const recordsDeliveryOut =
    recordsDelivery === 'upload' || recordsDelivery === 'request'
      ? recordsDelivery
      : undefined;

  return {
    okayToContactPreviousVets: okayToContactPreviousVetsOut,
    mayWeAskForRecords: mayWeAskForRecordsOut,
    recordsDelivery: recordsDeliveryOut,
  };
}

/** Mirror of veterinaryHistory row labels in appointmentRequestDetailDisplay. */
function veterinaryHistoryLabels(requestData) {
  const labels = [];
  const mayAsk = pickYesNo(requestData.mayWeAskForRecords);
  const recordsDelivery = pickStr(requestData.recordsDelivery);
  if (recordsDelivery === 'upload') labels.push('Records');
  else if (recordsDelivery === 'request') labels.push('Records');
  else if (mayAsk) labels.push('May we ask for records');

  const prevPractices =
    pickStr(requestData.previousVeterinaryPractices) ??
    pickStr(requestData.previousVeterinaryPracticesExisting);
  if (prevPractices) labels.push('Previous veterinary practices');

  const okayContact =
    pickYesNo(requestData.okayToContactPreviousVets) ??
    pickYesNo(requestData.okayToContactPreviousVetsExisting);
  const contactRedundantWithRecordsAsk =
    okayContact === 'Yes' && (mayAsk === 'Yes' || recordsDelivery === 'request');
  if (okayContact && !contactRedundantWithRecordsAsk) {
    labels.push('OK to contact previous vets');
  }
  return labels;
}

// --- Payload: request path must not emit both Yes fields ---
{
  const payload = buildVetHistoryPayload({
    isLoggedIn: false,
    recordsDelivery: 'request',
  });
  assert(payload.mayWeAskForRecords === 'Yes', 'request path sets mayWeAsk');
  assert(payload.recordsDelivery === 'request', 'request path sets delivery');
  assert(
    payload.okayToContactPreviousVets === undefined,
    'request path must not also set okayToContact=Yes',
  );
}

// --- Payload: upload / legacy new client still gets okayToContact ---
{
  const upload = buildVetHistoryPayload({
    isLoggedIn: false,
    recordsDelivery: 'upload',
  });
  assert(upload.okayToContactPreviousVets === 'Yes', 'upload keeps okayToContact');
  assert(upload.mayWeAskForRecords === undefined, 'upload does not set mayWeAsk');

  const legacy = buildVetHistoryPayload({ isLoggedIn: false, recordsDelivery: '' });
  assert(legacy.okayToContactPreviousVets === 'Yes', 'legacy new client okayToContact');
}

// --- Display: already-stored redundant payload hides okayToContact ---
{
  const husseyStyle = {
    previousVeterinaryPractices: 'Sunray Animal Clinic Brunswick',
    okayToContactPreviousVets: 'Yes',
    mayWeAskForRecords: 'Yes',
    recordsDelivery: 'request',
  };
  const labels = veterinaryHistoryLabels(husseyStyle);
  assert(
    labels.includes('Previous veterinary practices'),
    'keeps practice name',
  );
  assert(labels.includes('Records'), 'shows records-request line');
  assert(
    !labels.includes('OK to contact previous vets'),
    'hides redundant okayToContact',
  );
  assert(
    !labels.includes('May we ask for records'),
    'recordsDelivery request replaces mayAsk row',
  );
}

// --- Display: okayToContact alone still shows ---
{
  const labels = veterinaryHistoryLabels({
    previousVeterinaryPractices: 'Some Clinic',
    okayToContactPreviousVets: 'Yes',
  });
  assert(
    labels.includes('OK to contact previous vets'),
    'standalone okayToContact still visible',
  );
}

console.log('previousVetCareRedundantConsentSmoke: ok');
