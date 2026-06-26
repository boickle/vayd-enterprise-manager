/** Structured readout of persisted appointment request payloads for staff review. */

import { DateTime } from 'luxon';
import {
  formatRequestDataAddress,
  patientPimsIdFromRequestPet,
  requestDataAnythingElse,
  requestDataCanText,
  requestDataHowSoon,
  requestDataPhone,
  requestDataPreferredDoctor,
  requestDataSelfScheduledSlot,
  requestDataUsesAlternateVisitAddress,
  requestPetChartPatientId,
  requestPetIsUnlinkedInEvet,
} from './appointmentRequestDisplay';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function pickYesNo(v: unknown): string | null {
  const s = pickStr(v);
  if (s === 'Yes' || s === 'No') return s;
  return null;
}

export type AppointmentRequestDetailRow = {
  label: string;
  value: string;
  /** Long-form client answers shown in a callout. */
  variant?: 'default' | 'note';
};

export type AppointmentRequestPetDetail = {
  name: string;
  species: string | null;
  isNew: boolean;
  /** Internal patient id for chart modal. */
  patientId: string | null;
  /** PIMS patient id for eVet deep link. */
  patientPimsId: string | null;
  facts: AppointmentRequestDetailRow[];
  notes: AppointmentRequestDetailRow[];
};

export type AppointmentRequestDetailSections = {
  client: AppointmentRequestDetailRow[];
  address: AppointmentRequestDetailRow[];
  pets: AppointmentRequestPetDetail[];
  veterinaryHistory: AppointmentRequestDetailRow[];
  scheduling: AppointmentRequestDetailRow[];
  other: AppointmentRequestDetailRow[];
};

type PetRecord = Record<string, unknown>;

const NOTE_LABELS = new Set([
  'What is going on',
  'Visit details',
  'Interested in other options',
  'Aftercare preference',
  'Alerts',
  'Handling',
]);

function formatPetAgeOrDob(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const dt = DateTime.fromISO(raw);
    if (dt.isValid) {
      const years = Math.floor(DateTime.now().diff(dt, 'years').years);
      const agePart = years >= 0 ? ` · ${years} yr${years === 1 ? '' : 's'} old` : '';
      return `${dt.toFormat('MMM d, yyyy')}${agePart}`;
    }
  }
  return raw;
}

function formatAddress(addr: unknown): string | null {
  if (!addr || typeof addr !== 'object') return null;
  const a = addr as Record<string, unknown>;
  const parts = [
    pickStr(a.line1),
    pickStr(a.line2),
    [pickStr(a.city), pickStr(a.state)].filter(Boolean).join(', '),
    pickStr(a.zip),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function petPrimaryProviderName(pet: PetRecord): string | null {
  return (
    pickStr(pet.primaryProviderName) ??
    pickStr(pet.primaryProviderFullName) ??
    (() => {
      const pp = pet.primaryProvider;
      if (!pp || typeof pp !== 'object') return null;
      const o = pp as Record<string, unknown>;
      const parts = [pickStr(o.title), pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean);
      return parts.length ? parts.join(' ') : pickStr(o.name) ?? pickStr(o.fullName);
    })()
  );
}

function petChartPatientId(pet: PetRecord): string | null {
  return requestPetChartPatientId(pet);
}

function petIsNewOnRequest(pet: PetRecord): boolean {
  return requestPetIsUnlinkedInEvet(pet);
}

function handlingSummary(pet: PetRecord): string | null {
  const parts: string[] = [];
  if (pickYesNo(pet.needsCalmingMedications) === 'Yes') {
    parts.push(
      pickYesNo(pet.hasCalmingMedications) === 'Yes'
        ? 'Needs calming meds (has them)'
        : 'Needs calming meds',
    );
  }
  if (pickYesNo(pet.needsMuzzleOrSpecialHandling) === 'Yes') {
    parts.push('Muzzle / special handling');
  }
  if (pickYesNo(pet.needsExtraHandling) === 'Yes') {
    parts.push('Extra handling');
  }
  const behavior = pickStr(pet.behaviorAtPreviousVisits);
  if (behavior) parts.push(`Behavior: ${behavior}`);
  return parts.length ? parts.join(' · ') : null;
}

function collectPets(requestData: Record<string, unknown>): PetRecord[] {
  const pets = requestData.pets;
  if (Array.isArray(pets) && pets.length > 0) {
    return pets.filter((p): p is PetRecord => Boolean(p && typeof p === 'object'));
  }

  const allPets = requestData.allPets;
  if (Array.isArray(allPets) && allPets.length > 0) {
    return allPets.filter(
      (p): p is PetRecord =>
        Boolean(p && typeof p === 'object' && (p as PetRecord).isSelected !== false),
    );
  }

  const out: PetRecord[] = [];
  for (const key of ['newClientPets', 'existingClientNewPets'] as const) {
    const arr = requestData[key];
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (p && typeof p === 'object') out.push(p as PetRecord);
    }
  }
  return out;
}

function petId(pet: PetRecord): string | null {
  return pickStr(pet.id) ?? pickStr(pet.dbId);
}

function petSpecificFor(
  requestData: Record<string, unknown>,
  pet: PetRecord,
): Record<string, unknown> | null {
  const psd = requestData.petSpecificData;
  if (!psd || typeof psd !== 'object') return null;
  const keys = new Set<string>();
  for (const key of [pickStr(pet.id), pickStr(pet.dbId), petId(pet)]) {
    if (key) keys.add(key);
  }
  for (const key of keys) {
    const row = (psd as Record<string, unknown>)[key];
    if (row && typeof row === 'object') return row as Record<string, unknown>;
  }
  return null;
}

function petNameById(requestData: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const addPet = (pet: PetRecord) => {
    const name = pickStr(pet.name);
    if (!name) return;
    for (const key of [pickStr(pet.id), pickStr(pet.dbId)]) {
      if (key) out.set(key, name);
    }
  };

  for (const key of ['pets', 'allPets', 'newClientPets', 'existingClientNewPets'] as const) {
    const arr = requestData[key];
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (p && typeof p === 'object') addPet(p as PetRecord);
    }
  }
  return out;
}

function petRecordById(requestData: Record<string, unknown>): Map<string, PetRecord> {
  const out = new Map<string, PetRecord>();
  const addPet = (pet: PetRecord) => {
    for (const key of [pickStr(pet.id), pickStr(pet.dbId)]) {
      if (key) out.set(key, pet);
    }
  };
  for (const key of ['pets', 'allPets', 'newClientPets', 'existingClientNewPets'] as const) {
    const arr = requestData[key];
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (p && typeof p === 'object') addPet(p as PetRecord);
    }
  }
  return out;
}

function petRowSummariesFromPetSpecificData(
  requestData: Record<string, unknown>,
): AppointmentRequestPetRowSummary[] {
  const psd = requestData.petSpecificData;
  if (!psd || typeof psd !== 'object') return [];
  const names = petNameById(requestData);
  const records = petRecordById(requestData);
  const fallbackType = pickStr(requestData.appointmentType);
  const rows: AppointmentRequestPetRowSummary[] = [];

  for (const [key, raw] of Object.entries(psd as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const specific = raw as Record<string, unknown>;
    const pet = records.get(key);
    const isNew = pet ? petIsNewOnRequest(pet) : true;
    const appointmentType =
      pickStr(specific.needsToday) ??
      pickStr(specific.appointmentTypeName) ??
      fallbackType;
    const rawTypeId = specific.appointmentTypeId;
    const appointmentTypeId =
      rawTypeId != null && Number.isFinite(Number(rawTypeId)) && Number(rawTypeId) > 0
        ? Number(rawTypeId)
        : null;
    const allowTopLevelFallback = Object.keys(psd as Record<string, unknown>).length === 1;
    rows.push({
      key,
      name: names.get(key) ?? pickStr(pet?.name) ?? 'Pet',
      patientId: pet ? petChartPatientId(pet) : null,
      patientPimsId: pet ? patientPimsIdFromRequestPet(pet) : null,
      appointmentType,
      appointmentTypeId,
      primaryProvider: pet && !isNew ? petPrimaryProviderName(pet) : null,
      clientDetails: buildAppointmentRequestPetClientDetails(requestData, specific, {
        allowTopLevelFallback,
      }),
      euthNotes: appointmentRequestPetEuthNotesFromRequestData(requestData, specific, {
        allowTopLevelFallback,
      }),
    });
  }

  return rows;
}

/** Compact per-pet lines for appointment request list rows. */
export type AppointmentRequestPetRowSummary = {
  key: string;
  name: string;
  patientId: string | null;
  patientPimsId: string | null;
  appointmentType: string | null;
  appointmentTypeId: number | null;
  primaryProvider: string | null;
  clientDetails: string | null;
  euthNotes?: AppointmentRequestPetEuthNotes;
};

import {
  buildAppointmentRequestPetClientDetails,
  buildAppointmentRequestPetStaffInstructions,
  type AppointmentRequestPetEuthNotes,
  appointmentRequestPetEuthNotesFromRequestData,
} from './appointmentRequestPetStaffNotes';

export function requestDataPetRowSummaries(
  requestData: Record<string, unknown>,
): AppointmentRequestPetRowSummary[] {
  const pets = collectPets(requestData);
  const allowTopLevelFallback = pets.length === 1;

  const rows: AppointmentRequestPetRowSummary[] = pets.map((pet, index) => {
    const name = pickStr(pet.name) ?? 'Pet';
    const isNew = petIsNewOnRequest(pet);
    const id = petId(pet);
    const specific = petSpecificFor(requestData, pet);
    const appointmentType =
      (specific ? pickStr(specific.needsToday) ?? pickStr(specific.appointmentTypeName) : null) ??
      pickStr(requestData.appointmentType);
    const rawTypeId = specific?.appointmentTypeId;
    const appointmentTypeId =
      rawTypeId != null && Number.isFinite(Number(rawTypeId)) && Number(rawTypeId) > 0
        ? Number(rawTypeId)
        : null;

    const euthNotes = appointmentRequestPetEuthNotesFromRequestData(requestData, specific, {
      allowTopLevelFallback,
    });

    return {
      key: id ?? `pet-${index}-${name}`,
      name,
      patientId: petChartPatientId(pet),
      patientPimsId: patientPimsIdFromRequestPet(pet),
      appointmentType,
      appointmentTypeId,
      primaryProvider: isNew ? null : petPrimaryProviderName(pet),
      clientDetails: buildAppointmentRequestPetClientDetails(requestData, specific, {
        allowTopLevelFallback,
      }),
      euthNotes,
    };
  });

  const petInfoText =
    pickStr(requestData.petInfoText) ?? pickStr(requestData.whatPets) ?? pickStr(requestData.newPetInfo);
  if (rows.length === 0) {
    rows.push(...petRowSummariesFromPetSpecificData(requestData));
  }
  if (rows.length === 0 && petInfoText) {
    rows.push({
      key: 'pet-info-text',
      name: 'Pet information',
      patientId: null,
      patientPimsId: null,
      appointmentType: pickStr(requestData.appointmentType),
      appointmentTypeId: null,
      primaryProvider: null,
      clientDetails: petInfoText,
    });
  }

  return rows;
}

function asRow(label: string, value: string, variant: 'default' | 'note' = 'default'): AppointmentRequestDetailRow {
  return { label, value, variant: NOTE_LABELS.has(label) || variant === 'note' ? 'note' : 'default' };
}

function formatTimePreferences(
  requestData: Record<string, unknown>,
  practiceTz: string,
): string | null {
  const prefs = requestData.selectedDateTimePreferences;
  if (!Array.isArray(prefs) || prefs.length === 0) return null;
  const sorted = [...prefs].sort((a, b) => {
    const pa = Number((a as { preference?: unknown })?.preference) || 999;
    const pb = Number((b as { preference?: unknown })?.preference) || 999;
    return pa - pb;
  });
  const lines: string[] = [];
  for (const pref of sorted) {
    if (!pref || typeof pref !== 'object') continue;
    const o = pref as Record<string, unknown>;
    const display = pickStr(o.display);
    const dt = pickStr(o.dateTime);
    const rank = pickStr(o.preference) ?? '';
    if (display) {
      lines.push(rank ? `${rank}. ${display}` : display);
      continue;
    }
    if (dt) {
      const parsed = DateTime.fromISO(dt, { zone: 'utc' }).setZone(practiceTz);
      const formatted = parsed.isValid ? parsed.toFormat('EEE, MMM d · h:mm a') : dt;
      lines.push(rank ? `${rank}. ${formatted}` : formatted);
    }
  }
  return lines.length ? lines.join('\n') : null;
}

function formatSelfScheduledSlot(
  requestData: Record<string, unknown>,
  practiceTz: string,
): string | null {
  const slot = requestDataSelfScheduledSlot(requestData);
  if (!slot) return null;
  const parts: string[] = [];
  if (slot.doctorName) parts.push(slot.doctorName);
  if (slot.appointmentStart) {
    const dt = DateTime.fromISO(slot.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
    parts.push(dt.isValid ? dt.toFormat('EEE, MMM d · h:mm a') : slot.appointmentStart);
  }
  if (slot.windowDisplay) parts.push(slot.windowDisplay);
  else if (slot.windowStartIso && slot.windowEndIso) {
    const start = DateTime.fromISO(slot.windowStartIso, { zone: 'utc' }).setZone(practiceTz);
    const end = DateTime.fromISO(slot.windowEndIso, { zone: 'utc' }).setZone(practiceTz);
    if (start.isValid && end.isValid) {
      parts.push(`Arrival ${start.toFormat('h:mm a')}–${end.toFormat('h:mm a')}`);
    }
  }
  return parts.length ? parts.join(' · ') : null;
}

export function buildAppointmentRequestDetailSections(
  requestData: Record<string, unknown>,
  practiceTz?: string,
): AppointmentRequestDetailSections {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const fn = (requestData.fullName as { first?: string; last?: string }) ?? {};
  const fullName = [pickStr(fn.first), pickStr(fn.last)].filter(Boolean).join(' ');

  const client: AppointmentRequestDetailRow[] = [];
  if (fullName) client.push({ label: 'Name', value: fullName });
  const email = pickStr(requestData.email);
  if (email) client.push({ label: 'Email', value: email });
  const phone = requestDataPhone(requestData);
  if (phone) client.push({ label: 'Phone', value: phone });
  const canText = requestDataCanText(requestData);
  if (canText) client.push({ label: 'OK to text', value: canText });
  const clientType = pickStr(requestData.clientType);
  if (clientType) {
    client.push({
      label: 'Client type',
      value: clientType === 'existing' ? 'Existing client' : 'New client',
    });
  }

  const address: AppointmentRequestDetailRow[] = [];
  const visitAddress = formatRequestDataAddress(requestData);
  const usesAlternateVisitAddress = requestDataUsesAlternateVisitAddress(requestData);
  if (visitAddress && !usesAlternateVisitAddress) {
    address.push({ label: 'Visit address', value: visitAddress });
  }
  const mailing = formatAddress(requestData.mailingAddress);
  if (mailing) address.push({ label: 'Mailing address', value: mailing });
  const condo = pickStr(requestData.condoApartmentInfo);
  if (condo) address.push({ label: 'Access / condo info', value: condo });

  const pets: AppointmentRequestPetDetail[] = collectPets(requestData).map((pet) => {
    const name = pickStr(pet.name) ?? 'Pet';
    const isNew = petIsNewOnRequest(pet);
    const species = pickStr(pet.species);
    const facts: AppointmentRequestDetailRow[] = [];
    const notes: AppointmentRequestDetailRow[] = [];

    if (species) facts.push({ label: 'Species', value: species });
    const breed = pickStr(pet.breed);
    if (breed) facts.push({ label: 'Breed', value: breed });
    const age = formatPetAgeOrDob(pickStr(pet.age) ?? pickStr(pet.dob));
    if (age) facts.push({ label: 'Age / DOB', value: age });
    const weight = pickStr(pet.weight);
    if (weight) facts.push({ label: 'Weight', value: weight });
    const sex = pickStr(pet.sex);
    if (sex) facts.push({ label: 'Sex', value: sex });
    const spayed = pickYesNo(pet.spayedNeutered);
    if (spayed) facts.push({ label: 'Spayed / neutered', value: spayed });

    const primaryProvider = petPrimaryProviderName(pet);
    if (primaryProvider) {
      facts.push({ label: 'Primary provider', value: primaryProvider });
    } else if (!isNew) {
      facts.push({ label: 'Primary provider', value: 'Not on file' });
    }

    const specific = petSpecificFor(requestData, pet);
    if (specific) {
      const reason =
        pickStr(specific.needsToday) ??
        pickStr(specific.appointmentTypeName) ??
        pickStr(requestData.appointmentType);
      if (reason) facts.push({ label: 'Reason for visit', value: reason });
    }

    const alerts = pickStr(pet.alerts);
    if (alerts) notes.push(asRow('Alerts', alerts, 'note'));
    const handling = handlingSummary(pet);
    if (handling) notes.push(asRow('Handling', handling, 'note'));

    if (specific) {
      const details = pickStr(specific.needsTodayDetails);
      if (details) notes.push(asRow('Visit details', details, 'note'));
      const euthReason = pickStr(specific.euthanasiaReason);
      if (euthReason) notes.push(asRow('What is going on', euthReason, 'note'));
      const otherOptions = pickStr(specific.interestedInOtherOptions);
      if (otherOptions) notes.push(asRow('Interested in other options', otherOptions, 'note'));
      const aftercare = pickStr(specific.aftercarePreference);
      if (aftercare) notes.push(asRow('Aftercare preference', aftercare, 'note'));
    }

    return {
      name,
      species,
      isNew,
      patientId: petChartPatientId(pet),
      patientPimsId: patientPimsIdFromRequestPet(pet),
      facts,
      notes,
    };
  });

  const petInfoText =
    pickStr(requestData.petInfoText) ?? pickStr(requestData.whatPets) ?? pickStr(requestData.newPetInfo);
  if (pets.length === 0 && petInfoText) {
    pets.push({
      name: 'Pet information',
      species: null,
      isNew: false,
      patientId: null,
      patientPimsId: null,
      facts: [],
      notes: [{ label: 'Details', value: petInfoText, variant: 'note' }],
    });
  }

  const veterinaryHistory: AppointmentRequestDetailRow[] = [];
  const hadElsewhere = pickYesNo(requestData.hadVetCareElsewhere);
  if (hadElsewhere) {
    veterinaryHistory.push({ label: 'Vet care elsewhere since last visit', value: hadElsewhere });
  }
  const hospitals = pickStr(requestData.previousVeterinaryHospitals);
  if (hospitals) veterinaryHistory.push(asRow('Other hospitals', hospitals, 'note'));
  const mayAsk = pickYesNo(requestData.mayWeAskForRecords);
  if (mayAsk) veterinaryHistory.push({ label: 'May we ask for records', value: mayAsk });
  const prevPractices =
    pickStr(requestData.previousVeterinaryPractices) ??
    pickStr(requestData.previousVeterinaryPracticesExisting);
  if (prevPractices) {
    veterinaryHistory.push(asRow('Previous veterinary practices', prevPractices, 'note'));
  }
  const okayContact =
    pickStr(requestData.okayToContactPreviousVets) ??
    pickStr(requestData.okayToContactPreviousVetsExisting);
  if (okayContact) {
    veterinaryHistory.push({ label: 'OK to contact previous vets', value: okayContact });
  }

  const scheduling: AppointmentRequestDetailRow[] = [];
  const howSoon = requestDataHowSoon(requestData);
  if (howSoon) scheduling.push({ label: 'How soon', value: howSoon });
  const preferredDoctor = requestDataPreferredDoctor(requestData);
  if (preferredDoctor) {
    scheduling.push({ label: 'Preferred doctor', value: preferredDoctor });
  }
  const apptType = pickStr(requestData.appointmentType);
  if (apptType) scheduling.push({ label: 'Appointment type', value: apptType });
  const serviceArea = pickStr(requestData.serviceArea) ?? pickStr(requestData.serviceAreaVisit);
  if (serviceArea) scheduling.push({ label: 'Service area', value: serviceArea });

  const selfSlot = formatSelfScheduledSlot(requestData, tz);
  if (selfSlot) scheduling.push({ label: 'Self-scheduled slot', value: selfSlot });
  else {
    const timePrefs = formatTimePreferences(requestData, tz);
    if (timePrefs) scheduling.push(asRow('Preferred times', timePrefs, 'note'));
  }

  if (requestData.noneOfWorkForMe === true) {
    scheduling.push({ label: 'Preferred times', value: 'None of the suggested times work' });
  }

  const preferredDateTime = pickStr(requestData.preferredDateTime);
  if (preferredDateTime) {
    scheduling.push({ label: 'Preferred date / time', value: preferredDateTime });
  }

  const schedulingNotes = pickStr(requestData.schedulingNotes);
  if (schedulingNotes) scheduling.push(asRow('Scheduling notes', schedulingNotes, 'note'));

  if (requestData.onlineBooking === true) {
    scheduling.push({ label: 'Online booking', value: 'Yes' });
  }

  const other: AppointmentRequestDetailRow[] = [];
  const anythingElse = requestDataAnythingElse(requestData);
  if (anythingElse) other.push(asRow('Client note', anythingElse, 'note'));
  const visitDetails = pickStr(requestData.visitDetails);
  if (visitDetails && visitDetails !== anythingElse) {
    other.push(asRow('Visit details', visitDetails, 'note'));
  }
  const topEuthReason = pickStr(requestData.euthanasiaReason);
  if (topEuthReason) other.push(asRow('Euthanasia — what is going on', topEuthReason, 'note'));
  const topOtherOptions = pickStr(requestData.interestedInOtherOptions);
  if (topOtherOptions) {
    other.push(asRow('Interested in other options', topOtherOptions, 'note'));
  }
  const aftercare = pickStr(requestData.aftercarePreference);
  if (aftercare) other.push({ label: 'Aftercare preference', value: aftercare });
  const membership = pickStr(requestData.membershipInterest);
  if (membership) other.push({ label: 'Membership interest', value: membership });
  const otherPersons = pickStr(requestData.otherPersonsOnAccount);
  if (otherPersons) other.push(asRow('Others on account', otherPersons, 'note'));

  return { client, address, pets, veterinaryHistory, scheduling, other };
}
