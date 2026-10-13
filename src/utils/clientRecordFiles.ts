export const CLIENT_RECORD_MAX_BYTES = 20 * 1024 * 1024;
export const CLIENT_RECORD_MAX_FILES = 10;

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];

export function clientRecordFileError(file: File): string | null {
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  const extOk = ALLOWED_EXT.some((ext) => name.endsWith(ext));
  const typeOk =
    type === 'application/pdf' ||
    type.startsWith('image/');
  if (!extOk && !typeOk) {
    return 'Upload a photo (JPEG, PNG, HEIC) or a PDF.';
  }
  if (file.size > CLIENT_RECORD_MAX_BYTES) {
    return 'Each file must be 20 MB or smaller.';
  }
  if (file.size <= 0) {
    return 'That file is empty.';
  }
  return null;
}
