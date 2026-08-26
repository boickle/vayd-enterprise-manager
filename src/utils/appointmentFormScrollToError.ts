/** Scroll to the first validation error on the appointment request form. */
export function scrollToFirstAppointmentFormError(errors: Record<string, string>): void {
  const keys = Object.keys(errors);
  if (keys.length === 0 || typeof document === 'undefined') return;

  const scroll = () => {
    const target =
      findFirstErrorTargetInDomOrder(errors) ?? findFirstErrorTargetByKeyFallback(errors);
    if (!target) return;

    scrollElementIntoView(target);

    const focusable = target.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button[data-handling-need], button[data-pet-sex-option], button[data-how-soon], button[data-appointment-type-id], button[data-species-choice]',
    );
    if (focusable && typeof focusable.focus === 'function') {
      focusable.focus({ preventScroll: true });
    }
  };

  // Wait for React to paint error messages, then scroll (retries for layout / fixed-body scroll).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scroll();
      window.setTimeout(scroll, 120);
      window.setTimeout(scroll, 320);
    });
  });
}

function findFirstErrorTargetInDomOrder(errors: Record<string, string>): HTMLElement | null {
  const errorKeys = new Set(Object.keys(errors));
  const formRoot = document.querySelector('.appt-request-form') ?? document;

  let topmost: HTMLElement | null = null;
  let topmostY = Infinity;

  const consider = (field: HTMLElement) => {
    const y = field.getBoundingClientRect().top;
    if (y < topmostY) {
      topmostY = y;
      topmost = field;
    }
  };

  for (const field of formRoot.querySelectorAll<HTMLElement>('[data-form-field]')) {
    const key = field.getAttribute('data-form-field');
    if (key && errorKeys.has(key)) consider(field);
  }

  for (const anchor of formRoot.querySelectorAll<HTMLElement>('[data-form-error-for]')) {
    const key = anchor.getAttribute('data-form-error-for');
    if (key && errorKeys.has(key)) consider(anchor);
  }

  return topmost;
}

function findFirstErrorTargetByKeyFallback(errors: Record<string, string>): HTMLElement | null {
  for (const key of sortErrorKeysByVisualPriority(Object.keys(errors))) {
    const target = findScrollTargetForErrorKey(key);
    if (target) return target;
  }
  return null;
}

/** Top-to-bottom priority when DOM markers are missing. */
const VISUAL_FIELD_PRIORITY: string[] = [
  'email',
  'phoneNumbers',
  'fullName.first',
  'fullName.last',
  'physicalAddress.line1',
  'bestPhoneNumber',
  'isThisTheAddressWhereWeWillCome',
  'newPhysicalAddress.line1',
  'zoneNotServiced',
  'whatPets',
  'newClientPets',
  'selectedPetIds',
  'howSoon',
  'preferredDoctorExisting',
  'preferredDoctor',
  'preferredDateTime',
  'selectedDateTimeSlotsVisit',
  'selfScheduledSlot',
  'euthanasiaReason',
  'interestedInOtherOptions',
  'aftercarePreference',
];

function sortErrorKeysByVisualPriority(keys: string[]): string[] {
  const priorityIndex = (key: string): number => {
    const exact = VISUAL_FIELD_PRIORITY.indexOf(key);
    if (exact >= 0) return exact;

    if (key.startsWith('newClientPet.')) return 50;
    if (key.startsWith('existingClientNewPet.')) return 51;
    if (key.startsWith('needsToday.')) return 52;
    if (key.startsWith('euthanasiaReason.')) return 53;
    if (key.startsWith('interestedInOtherOptions.')) return 54;
    if (key.startsWith('aftercarePreference.')) return 55;

    return 1000;
  };

  return [...keys].sort((a, b) => {
    const diff = priorityIndex(a) - priorityIndex(b);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
}

function scrollElementIntoView(element: HTMLElement): void {
  const offset = getStickyHeaderOffset();

  // Native API scrolls all scrollable ancestors; respects scroll-margin on [data-form-field].
  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

  // App layout uses body/main as scroll roots (html overflow hidden) — window.scrollTo is a no-op.
  for (const root of getDocumentScrollRoots()) {
    const elRect = element.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const top = elRect.top - rootRect.top + root.scrollTop - offset;
    if (Math.abs(elRect.top - offset) > 16) {
      root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }
}

function getStickyHeaderOffset(): number {
  const header = document.querySelector('header');
  if (header) {
    const style = getComputedStyle(header);
    if (style.position === 'sticky' || style.position === 'fixed') {
      return header.getBoundingClientRect().height + 12;
    }
  }
  return 12;
}

function getDocumentScrollRoots(): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const main = document.querySelector('main');
  if (main instanceof HTMLElement) roots.push(main);
  roots.push(document.body);
  if (document.documentElement !== document.body) {
    roots.push(document.documentElement);
  }
  return roots.filter(isVerticallyScrollable);
}

function isVerticallyScrollable(el: HTMLElement): boolean {
  const { overflowY } = getComputedStyle(el);
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') {
    return false;
  }
  return el.scrollHeight > el.clientHeight + 1;
}

function findScrollTargetForErrorKey(key: string): HTMLElement | null {
  const escaped = CSS.escape(key);

  const byField = document.querySelector<HTMLElement>(`[data-form-field="${escaped}"]`);
  if (byField) return byField;

  const byError = document.querySelector<HTMLElement>(`[data-form-error-for="${escaped}"]`);
  if (byError) return byError;

  const newClientPet = key.match(/^newClientPet\.([^\.]+)\.(\w+)$/);
  if (newClientPet) {
    return findPetFieldTarget(newClientPet[1], newClientPet[2]);
  }

  const existingNewPet = key.match(/^existingClientNewPet\.([^\.]+)\.(\w+)$/);
  if (existingNewPet) {
    return findPetFieldTarget(existingNewPet[1], existingNewPet[2]);
  }

  const needsToday = key.match(/^needsToday\.(.+)$/);
  if (needsToday) {
    return (
      document.querySelector<HTMLElement>(`[data-pet-id="${CSS.escape(needsToday[1])}"] [data-appointment-type-picker]`) ||
      document.querySelector<HTMLElement>(
        `[data-pet-id="${CSS.escape(needsToday[1])}"] [data-form-field="needsToday.${CSS.escape(needsToday[1])}"]`,
      )
    );
  }

  const euthanasiaReason = key.match(/^euthanasiaReason\.(.+)$/);
  if (euthanasiaReason) {
    return document.querySelector<HTMLElement>(
      `[data-pet-id="${CSS.escape(euthanasiaReason[1])}"] [data-form-field="euthanasiaReason.${CSS.escape(euthanasiaReason[1])}"]`,
    );
  }

  const interestedInOther = key.match(/^interestedInOtherOptions\.(.+)$/);
  if (interestedInOther) {
    return document.querySelector<HTMLElement>(
      `[data-pet-id="${CSS.escape(interestedInOther[1])}"] [data-form-field="interestedInOtherOptions.${CSS.escape(interestedInOther[1])}"]`,
    );
  }

  const aftercarePreference = key.match(/^aftercarePreference\.(.+)$/);
  if (aftercarePreference) {
    return document.querySelector<HTMLElement>(
      `[data-pet-id="${CSS.escape(aftercarePreference[1])}"] [data-form-field="aftercarePreference.${CSS.escape(aftercarePreference[1])}"]`,
    );
  }

  const namedInput = document.querySelector<HTMLElement>(
    `input[name="${escaped}"], textarea[name="${escaped}"], select[name="${escaped}"]`,
  );
  if (namedInput) {
    return (
      namedInput.closest<HTMLElement>('[data-form-field]') ??
      namedInput.closest<HTMLElement>('div') ??
      namedInput
    );
  }

  return document.querySelector<HTMLElement>(`#${escaped}`);
}

function findPetFieldTarget(petId: string, field: string): HTMLElement | null {
  const petCard = document.querySelector<HTMLElement>(`[data-pet-id="${CSS.escape(petId)}"]`);
  if (!petCard) return null;

  const fieldSelectors: Record<string, string> = {
    name: '[data-form-field$=".name"]',
    age: '[data-form-field$=".age"]',
    species: '[data-species-picker]',
    sex: '[data-pet-sex-picker]',
    handlingNeeds: '[data-handling-needs-picker]',
  };

  const selector = fieldSelectors[field];
  if (selector) {
    const match = petCard.querySelector<HTMLElement>(selector);
    if (match) return match;
  }

  return petCard.querySelector<HTMLElement>(`[data-form-field$=".${CSS.escape(field)}"]`) || petCard;
}
