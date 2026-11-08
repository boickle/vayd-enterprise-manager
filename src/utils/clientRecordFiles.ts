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

/** Longest side for record photos sent to the check. Text stays readable at this size. */
const RECORD_PHOTO_MAX_SIDE = 2400;
/** The check reads images up to 5 MB. */
const RECORD_PHOTO_MAX_BYTES = 4.5 * 1024 * 1024;

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Shrink a record photo to a JPEG the check can read. PDFs pass through.
 * HEIC becomes JPEG where the browser can decode it (Safari); elsewhere the
 * original is returned and the server explains what to do.
 */
export async function prepareClientRecordFile(file: File): Promise<File> {
  const type = (file.type || '').toLowerCase();
  const name = file.name.toLowerCase();
  const isPdf = type === 'application/pdf' || name.endsWith('.pdf');
  if (isPdf) return file;
  const isHeic =
    type.includes('heic') ||
    type.includes('heif') ||
    name.endsWith('.heic') ||
    name.endsWith('.heif');
  if (!isHeic && file.size <= RECORD_PHOTO_MAX_BYTES && type !== 'image/gif') {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, RECORD_PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [0.85, 0.7, 0.55]) {
      blob = await canvasToJpeg(canvas, quality);
      if (blob && blob.size <= RECORD_PHOTO_MAX_BYTES) break;
    }
    if (!blob) return file;
    const dot = file.name.lastIndexOf('.');
    const base = (dot > 0 ? file.name.slice(0, dot) : file.name) || 'record';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

export type ClientRecordFileCheck =
  | { state: 'checking' }
  | { state: 'qualifies' | 'accepted'; token: string; message: string }
  | { state: 'rejected'; message: string };

type CheckedFile = { formPetId: string; check: ClientRecordFileCheck };

/** Tokens for every kept file, to send with slot search and submit. */
export function clientRecordCheckTokens(files: readonly CheckedFile[]): string[] {
  const tokens: string[] = [];
  for (const f of files) {
    if (f.check.state === 'qualifies' || f.check.state === 'accepted') tokens.push(f.check.token);
  }
  return tokens;
}

/**
 * Earlier booking opens only when each new pet has a qualifying record.
 * Mirrors the server rule; the server makes the final call.
 */
export function clientRecordsVerified(
  files: readonly CheckedFile[],
  newPetIds: readonly string[],
): boolean {
  const covered = new Set(
    files.filter((f) => f.check.state === 'qualifies').map((f) => f.formPetId),
  );
  if (covered.size === 0) return false;
  return newPetIds.every((id) => covered.has(id));
}

/** New pets that still need a qualifying record. */
export function petsMissingQualifyingRecords(
  files: readonly CheckedFile[],
  newPetIds: readonly string[],
): string[] {
  const covered = new Set(
    files.filter((f) => f.check.state === 'qualifies').map((f) => f.formPetId),
  );
  return newPetIds.filter((id) => !covered.has(id));
}
