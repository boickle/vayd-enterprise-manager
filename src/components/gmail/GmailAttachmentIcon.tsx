export type GmailAttachmentIconKind =
  | 'image'
  | 'pdf'
  | 'excel'
  | 'word'
  | 'powerpoint'
  | 'generic';

export function resolveGmailAttachmentIconKind(
  mimeType: string,
  filename: string,
): GmailAttachmentIconKind {
  const mime = mimeType.trim().toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';

  const ext = filename.trim().toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['xls', 'xlsx', 'xlsm', 'csv', 'ods'].includes(ext)) return 'excel';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'word';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'powerpoint';

  if (
    mime.includes('spreadsheet') ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'text/csv'
  ) {
    return 'excel';
  }
  if (mime.includes('wordprocessing') || mime === 'application/msword') {
    return 'word';
  }
  if (mime.includes('presentation') || mime === 'application/vnd.ms-powerpoint') {
    return 'powerpoint';
  }

  return 'generic';
}

type Props = {
  mimeType: string;
  filename: string;
  size?: number;
  className?: string;
};

export default function GmailAttachmentIcon({
  mimeType,
  filename,
  size = 14,
  className,
}: Props) {
  const kind = resolveGmailAttachmentIconKind(mimeType, filename);
  return (
    <span
      className={['gmail-attachment-icon', `gmail-attachment-icon--${kind}`, className]
        .filter(Boolean)
        .join(' ')}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {kind === 'image' ? <ImageIconSvg /> : null}
      {kind === 'pdf' ? <PdfIconSvg /> : null}
      {kind === 'excel' ? <ExcelIconSvg /> : null}
      {kind === 'word' ? <WordIconSvg /> : null}
      {kind === 'powerpoint' ? <PowerpointIconSvg /> : null}
      {kind === 'generic' ? <GenericIconSvg /> : null}
    </span>
  );
}

function ImageIconSvg() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="16" height="16" rx="2" fill="#EA4335" />
      <path
        d="M3.5 11.5L6 8.5L8 10.5L10.5 7.5L12.5 11.5H3.5Z"
        fill="white"
      />
      <circle cx="6" cy="5.5" r="1.25" fill="white" />
    </svg>
  );
}

function DocBase({ badgeColor, label }: { badgeColor: string; label: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 1.5H9.5L13 5V14.5H3V1.5Z"
        fill="#F8F9FA"
        stroke="#DADCE0"
        strokeWidth="0.75"
      />
      <path d="M9.5 1.5V5H13" fill="#E8EAED" stroke="#DADCE0" strokeWidth="0.75" />
      <rect x="3" y="9.5" width="7.5" height="5" rx="0.75" fill={badgeColor} />
      <text
        x="6.75"
        y="13.4"
        textAnchor="middle"
        fill="white"
        fontSize="4.5"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
      >
        {label}
      </text>
    </svg>
  );
}

function PdfIconSvg() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 1.5H9.5L13 5V14.5H3V1.5Z"
        fill="#F8F9FA"
        stroke="#DADCE0"
        strokeWidth="0.75"
      />
      <path d="M9.5 1.5V5H13" fill="#E8EAED" stroke="#DADCE0" strokeWidth="0.75" />
      <rect x="3" y="9.5" width="10" height="5" rx="0.75" fill="#EA4335" />
      <text
        x="8"
        y="13.35"
        textAnchor="middle"
        fill="white"
        fontSize="3.6"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
      >
        PDF
      </text>
    </svg>
  );
}

function ExcelIconSvg() {
  return <DocBase badgeColor="#0F9D58" label="X" />;
}

function WordIconSvg() {
  return <DocBase badgeColor="#4285F4" label="W" />;
}

function PowerpointIconSvg() {
  return <DocBase badgeColor="#F4B400" label="P" />;
}

function GenericIconSvg() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 1.5H9.5L13 5V14.5H3V1.5Z"
        fill="#F8F9FA"
        stroke="#DADCE0"
        strokeWidth="0.75"
      />
      <path d="M9.5 1.5V5H13" fill="#E8EAED" stroke="#DADCE0" strokeWidth="0.75" />
      <path
        d="M5.25 8H10.75M5.25 10H9.25M5.25 12H10.75"
        stroke="#9AA0A6"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}
