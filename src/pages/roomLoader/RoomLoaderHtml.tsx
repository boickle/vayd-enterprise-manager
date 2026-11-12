// src/pages/roomLoader/RoomLoaderHtml.tsx
// Renders the rich text a practice writes in Settings -> Room Loader. The copy is staff
// authored but still arrives over an unauthenticated token route, so it is sanitised on
// the way to the DOM.
import { sanitizeFormTemplateHtml } from '../../utils/sanitizeCommunicationHtml';

type Props = {
  html: string | null | undefined;
  className?: string;
};

function stripPastedEditorChrome(html: string): string {
  return html
    .replace(/\s*(?:background(?:-color)?|color)\s*:\s*[^;"']+;?/gi, '')
    .replace(/\sstyle=(["'])\s*\1/gi, '');
}

export default function RoomLoaderHtml({ html, className }: Props) {
  const raw = (html ?? '').trim();
  if (!raw) return null;
  return (
    <div
      className={className ? `rl-html ${className}` : 'rl-html'}
      dangerouslySetInnerHTML={{ __html: stripPastedEditorChrome(sanitizeFormTemplateHtml(raw)) }}
    />
  );
}
