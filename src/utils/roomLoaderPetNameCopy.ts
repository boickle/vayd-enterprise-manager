/** Old VAYD outdoor FeLV pitch used a sample name before `{petName}` existed in settings. */
const LEGACY_OUTDOOR_FELV_OPENER = /It appears that Andy has/gi;

/** Rewrites stored outdoor pitch HTML so `{petName}` works on the client form. */
export function migrateLegacyOutdoorPitchHtml(html: string): string {
  return String(html ?? '').replace(LEGACY_OUTDOOR_FELV_OPENER, 'It appears that {petName} has');
}

/** Substitutes `{petName}` in configured question copy. */
export function fillPetName(template: string, petName: string): string {
  const name = petName?.trim() || 'your pet';
  let text = migrateLegacyOutdoorPitchHtml(String(template ?? ''));
  text = text.replace(LEGACY_OUTDOOR_FELV_OPENER, `It appears that ${name} has`);
  return text.replace(/\{petName\}/g, name);
}
