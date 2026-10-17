/** Longest edge stored on Room Loader config (data URLs ride in the JSON document). */
const MAX_EDGE_PX = 720;
const JPEG_QUALITY = 0.82;
const MAX_DATA_URL_CHARS = 180_000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
/** Decode a 20MP bitmap and the tab goes white; reject before Image() allocates. */
const MAX_SOURCE_PIXELS = 8_000_000;

type ImageSize = { width: number; height: number };

function readUint16(bytes: Uint8Array, offset: number, littleEndian = false): number {
  return littleEndian
    ? bytes[offset]! | (bytes[offset + 1]! << 8)
    : (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>>
    0
  );
}

/** PNG IHDR is in the first 24 bytes. */
function pngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null;
  if (readUint32(bytes, 0) !== 0x89504e47 || readUint32(bytes, 4) !== 0x0d0a1a0a) return null;
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  if (!width || !height) return null;
  return { width, height };
}

/** Walk JPEG markers until SOF for pixel size. */
function jpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1]!;
    i += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 2 > bytes.length) break;
    const length = readUint16(bytes, i);
    if (length < 2) break;
    const sof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (sof && i + 7 < bytes.length) {
      const height = readUint16(bytes, i + 3);
      const width = readUint16(bytes, i + 5);
      if (width && height) return { width, height };
      return null;
    }
    i += length;
  }
  return null;
}

async function peekImageSize(file: File): Promise<ImageSize | null> {
  const head = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
  return pngSize(head) ?? jpegSize(head);
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image. Try exporting it as a PNG or JPEG.'));
    };
    img.src = url;
  });
}

async function sourceForDraw(file: File, size: ImageSize | null): Promise<CanvasImageSource> {
  const srcW = size?.width ?? 0;
  const srcH = size?.height ?? 0;
  const scale = srcW && srcH ? Math.min(1, MAX_EDGE_PX / Math.max(srcW, srcH)) : 1;
  const resizeWidth = srcW ? Math.max(1, Math.round(srcW * scale)) : MAX_EDGE_PX;
  const resizeHeight = srcH ? Math.max(1, Math.round(srcH * scale)) : MAX_EDGE_PX;
  if (typeof createImageBitmap === 'function') {
    try {
      return srcW && srcH
        ? await createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: 'high' })
        : await createImageBitmap(file);
    } catch {
      // Fall through to HTMLImageElement.
    }
  }
  return loadImageFile(file);
}

function sourceSize(source: CanvasImageSource, fallback: ImageSize | null): ImageSize {
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }
  return fallback ?? { width: 0, height: 0 };
}

/**
 * Decode a staff-picked image and store a small JPEG data URL. Lab-graph PNGs
 * are often tiny on disk and enormous in pixels; decoding those raw used to
 * white-screen Settings.
 */
export async function fileToEmbeddedImageDataUrl(file: File): Promise<string> {
  const type = (file.type || '').toLowerCase();
  const namedOk = /\.(jpe?g|png|gif|webp)$/i.test(file.name);
  if (type && !type.startsWith('image/') && !namedOk) {
    throw new Error('Please choose a PNG or JPEG image.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('That image is over 8MB. Please crop or shrink it and try again.');
  }

  const peeked = await peekImageSize(file);
  if (peeked && peeked.width * peeked.height > MAX_SOURCE_PIXELS) {
    throw new Error(
      'That image has too many pixels for this page. Export a smaller PNG or JPEG and try again.'
    );
  }

  const source = await sourceForDraw(file, peeked);
  const { width: rawW, height: rawH } = sourceSize(source, peeked);
  if (!rawW || !rawH) throw new Error('That image has no size.');
  if (rawW * rawH > MAX_SOURCE_PIXELS) {
    throw new Error(
      'That image has too many pixels for this page. Export a smaller PNG or JPEG and try again.'
    );
  }

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(rawW, rawH));
  const width = Math.max(1, Math.round(rawW * scale));
  const height = Math.max(1, Math.round(rawH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare that image.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();

  let quality = JPEG_QUALITY;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > MAX_DATA_URL_CHARS && quality > 0.45) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new Error('That image is still too large after shrinking. Please crop it and try again.');
  }
  return dataUrl;
}
