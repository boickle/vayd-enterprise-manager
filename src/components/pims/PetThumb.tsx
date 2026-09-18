import { useState } from 'react';
import { PawPrint } from 'lucide-react';

/** Pet photo, or a paw if the URL is missing or the file is gone. */
export function PetThumb({
  src,
  size,
  className,
}: {
  src: string | null;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const usable = Boolean(src && !failed);
  if (!usable) {
    const first = className?.trim().split(/\s+/)[0];
    return (
      <span className={first ? `${className} ${first}--ph` : className} aria-hidden>
        <PawPrint size={Math.max(12, Math.round(size * 0.42))} />
      </span>
    );
  }
  return (
    <img
      className={className}
      src={src!}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Resolve a displayable pet photo URL.
 * DB stores an S3 key (`pets/123/….jpeg`); browsers need the public API proxy
 * `GET /patients/:id/image` (same pattern as employee photos).
 */
export function patientPhotoSrc(
  patientId: string | number | null | undefined,
  imageUrl: unknown,
  apiBase: string,
): string | null {
  const id = patientId != null ? String(patientId).trim() : '';
  const raw = imageUrl == null ? '' : String(imageUrl).trim();
  if (!raw && !id) return null;
  // No stored image key / URL → no photo.
  if (!raw) return null;
  const base = apiBase.replace(/\/+$/, '');
  if (id) {
    // Prefer the stable proxy whenever we know the patient — works for S3 keys
    // and avoids expired signed URLs from older portal responses.
    return `${base}/patients/${encodeURIComponent(id)}/image`;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${base}${raw}`;
  return null;
}

/** @deprecated Prefer {@link patientPhotoSrc} with a patient id. */
export function publicMediaUrl(path: unknown, apiBase: string): string | null {
  if (path == null) return null;
  const p = String(path).trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/')) return `${apiBase.replace(/\/+$/, '')}${p}`;
  return null;
}
