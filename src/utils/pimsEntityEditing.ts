/**
 * Legacy flag. Staff records are Scout-owned and editable without it.
 * Kept so older env files do not break the build.
 */
export const EMPLOYEE_DIRECTORY_EDIT_ENABLED =
  String(import.meta.env.VITE_ENABLE_PIMS_ENTITY_EDIT ?? '')
    .trim()
    .toLowerCase() === 'true';
