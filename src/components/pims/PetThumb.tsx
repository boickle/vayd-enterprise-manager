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

/** Only a real browser URL. S3 keys like `pets/123/….jpeg` are not loadable as-is. */
export function publicMediaUrl(path: unknown, apiBase: string): string | null {
  if (path == null) return null;
  const p = String(path).trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  return null;
}
