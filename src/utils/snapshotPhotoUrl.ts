/**
 * Pet Snapshot cards show a smaller copy of each photo (`size=card` on the photo URL).
 * Save image uses the original: drop `size` and keep the rest (the access token).
 */
export function fullSizePhotoUrl(src: string): string {
  try {
    const url = new URL(src, window.location.href);
    if (!url.searchParams.has('size')) return src;
    url.searchParams.delete('size');
    return url.href;
  } catch {
    return src;
  }
}
