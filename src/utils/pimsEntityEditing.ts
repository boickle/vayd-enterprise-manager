/**
 * When false (default): client detail, patient detail, and Settings → Employee directory
 * hide all edit / add / save / deactivate / delete actions (read-only).
 *
 * Enable later without removing code:
 * set `VITE_ENABLE_PIMS_ENTITY_EDIT=true` in `.env` and restart the dev server / rebuild.
 */
export const PIMS_ENTITY_EDIT_ENABLED =
  String(import.meta.env.VITE_ENABLE_PIMS_ENTITY_EDIT ?? '')
    .trim()
    .toLowerCase() === 'true';
