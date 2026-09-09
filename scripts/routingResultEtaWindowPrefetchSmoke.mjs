/**
 * Smoke: Get Best Route ETA window-warning prefetch payload shape
 * (Whelan / Crispell #bugs-scout 1788960436.153099).
 *
 * Run: node scripts/routingResultEtaWindowPrefetchSmoke.mjs
 */

function practiceDateKey(isoOrDate) {
  const s = String(isoOrDate ?? '').trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function buildRoutingResultEtaPrefetchPreview(input) {
  const date = practiceDateKey(input.option.date);
  const opt = input.option;
  return {
    version: 1,
    listOptionKey: input.optionKey,
    option: {
      date,
      suggestedStartIso: opt.suggestedStartIso,
      doctorPimsId: input.doctorInternalId,
      doctorName: opt.doctorName,
      insertionIndex: opt.insertionIndex,
      ...(typeof opt.positionInDay === 'number' ? { positionInDay: opt.positionInDay } : {}),
      ...(opt.arrivalWindow?.windowStartIso && opt.arrivalWindow?.windowEndIso
        ? {
            arrivalWindow: {
              windowStartIso: opt.arrivalWindow.windowStartIso,
              windowEndIso: opt.arrivalWindow.windowEndIso,
            },
          }
        : {}),
      ...(opt.candidateIndex != null ? { candidateIndex: opt.candidateIndex } : {}),
      ...(opt.candidateId ? { candidateId: opt.candidateId } : {}),
    },
    serviceMinutes: Math.max(1, Math.floor(input.serviceMinutes) || 30),
    newApptMeta: { ...input.newApptMeta },
    appointmentTypeId: input.appointmentTypeId,
    candidateIndex: opt.candidateIndex,
    candidateId: opt.candidateId,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const preview = buildRoutingResultEtaPrefetchPreview({
  optionKey: 'pims-2026-10-08-1-0',
  doctorInternalId: 'emp-42',
  option: {
    date: '2026-10-08T00:00:00.000Z',
    suggestedStartIso: '2026-10-08T15:00:00.000Z',
    doctorPimsId: 'pims',
    doctorName: 'Heather Crispell',
    insertionIndex: 1,
    positionInDay: 2,
    candidateIndex: 0,
    arrivalWindow: {
      windowStartIso: '2026-10-08T14:30:00.000Z',
      windowEndIso: '2026-10-08T15:30:00.000Z',
    },
  },
  serviceMinutes: 45,
  appointmentTypeId: 99,
  newApptMeta: { lat: 43.64, lon: -70.24, address: '267 Highland Ave' },
});

assert(preview.listOptionKey === 'pims-2026-10-08-1-0', 'preserves list option key (PIMS)');
assert(preview.option.doctorPimsId === 'emp-42', 'calendar option uses internal doctor id');
assert(preview.option.date === '2026-10-08', 'normalizes practice date key');
assert(preview.option.positionInDay === 2, 'forwards positionInDay');
assert(
  preview.option.arrivalWindow?.windowEndIso === '2026-10-08T15:30:00.000Z',
  'forwards slot-search arrival window'
);
assert(preview.serviceMinutes === 45, 'service minutes');
assert(preview.newApptMeta.lat === 43.64, 'newAppt coords for candidateSlot');

console.log('routingResultEtaWindowPrefetchSmoke: ok');
