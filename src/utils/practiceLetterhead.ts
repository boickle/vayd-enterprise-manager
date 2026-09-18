import { fetchPracticeInfo, fetchPracticeInfoById } from '../api/clientPortal';
import { getPracticeSettings, updatePracticeSettings } from '../api/practiceSettings';

export type PracticeLetterhead = {
  name: string;
  phone: string;
  address: string;
  logoDataUrl: string | null;
};

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function infoAddress(info: {
  address?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
} | null): string {
  if (!info) return '';
  return (
    [
      info.address1 ?? info.address,
      [info.city, info.state, info.zip].filter(Boolean).join(', '),
    ]
      .filter(Boolean)
      .join(' · ')
      .trim()
  );
}

export async function loadPracticeLetterhead(
  practiceId: number = PRACTICE_ID
): Promise<PracticeLetterhead> {
  const [settings, info, infoById] = await Promise.all([
    getPracticeSettings(practiceId).catch(() => null),
    fetchPracticeInfo().catch(() => null),
    fetchPracticeInfoById(practiceId).catch(() => null),
  ]);
  const clinic = infoById ?? info;
  const logo = settings?.['labels.practiceLogo']?.trim() ?? '';
  return {
    name: settings?.['labels.practiceName']?.trim() || clinic?.name?.trim() || '',
    phone:
      settings?.['labels.practicePhone']?.trim() ||
      (clinic?.phone ?? clinic?.phone1 ?? clinic?.phone2 ?? '').trim(),
    address: settings?.['labels.practiceAddress']?.trim() || infoAddress(clinic),
    logoDataUrl: logo.startsWith('data:image/') ? logo : null,
  };
}

export async function savePracticeLetterhead(
  letterhead: PracticeLetterhead,
  practiceId: number = PRACTICE_ID
): Promise<void> {
  await updatePracticeSettings(practiceId, {
    'labels.practiceName': letterhead.name.trim(),
    'labels.practicePhone': letterhead.phone.trim(),
    'labels.practiceAddress': letterhead.address.trim(),
    'labels.practiceLogo': letterhead.logoDataUrl ?? '',
  });
}

export function readImageAsLabelPng(file: File, maxEdge = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(maxEdge / image.width, maxEdge / image.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read the image.'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = pixels.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const value = gray < 200 ? 0 : 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image.'));
    };
    image.src = url;
  });
}

export async function loadProviderSignature(
  employeeId: number,
  practiceId: number = PRACTICE_ID
): Promise<string | null> {
  const settings = await getPracticeSettings(practiceId).catch(() => null);
  const raw = settings?.['labels.providerSignatures'];
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, unknown>;
    const value = map[String(employeeId)];
    return typeof value === 'string' && value.startsWith('data:image/') ? value : null;
  } catch {
    return null;
  }
}

export async function saveProviderSignature(
  employeeId: number,
  dataUrl: string | null,
  practiceId: number = PRACTICE_ID
): Promise<void> {
  const settings = await getPracticeSettings(practiceId).catch(() => ({}));
  let map: Record<string, string> = {};
  try {
    const raw = (settings as Record<string, unknown> | undefined)?.[
      'labels.providerSignatures'
    ];
    const parsed = JSON.parse(typeof raw === 'string' ? raw : '{}');
    if (parsed && typeof parsed === 'object') map = parsed as Record<string, string>;
  } catch {
    map = {};
  }
  if (dataUrl) map[String(employeeId)] = dataUrl;
  else delete map[String(employeeId)];
  await updatePracticeSettings(practiceId, {
    'labels.providerSignatures': JSON.stringify(map),
  });
}
