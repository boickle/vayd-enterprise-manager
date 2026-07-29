/**
 * Gates edit / add / deactivate actions in Settings → Employee directory.
 *
 * Client and patient management is no longer gated — Scout owns those records outright
 * (see `utils/pimsScoutManaged.ts`). The employee directory still lacks Scout-side write
 * endpoints, so it stays read-only unless `VITE_ENABLE_PIMS_ENTITY_EDIT=true` is set.
 */
export const EMPLOYEE_DIRECTORY_EDIT_ENABLED =
  String(import.meta.env.VITE_ENABLE_PIMS_ENTITY_EDIT ?? '')
    .trim()
    .toLowerCase() === 'true';
