import { useEffect, useRef } from 'react';
import { Bold } from 'lucide-react';
import {
  looksLikeHtmlFragment,
  sanitizeSoapHtml,
  soapHtmlToPlainText,
} from '../../utils/sanitizeCommunicationHtml';

type Props = {
  value: string;
  onChange: (htmlOrText: string) => void;
  onBlur: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Prefer taller document-view editors. */
  minHeightPx?: number;
};

/** Turn plain SOAP notes into editable HTML while preserving line breaks. */
export function soapTextToEditorHtml(value: string): string {
  const raw = value ?? '';
  if (!raw.trim()) return '';
  if (looksLikeHtmlFragment(raw)) return sanitizeSoapHtml(raw);
  return sanitizeSoapHtml(
    raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
  );
}

/**
 * Lightweight rich-text field for SOAP Document view: bold toolbar + contentEditable.
 * Stores sanitized HTML (or plain text if the doctor never used formatting).
 */
export default function SoapRichTextField({
  value,
  onChange,
  onBlur,
  disabled,
  placeholder,
  className,
  minHeightPx = 220,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const next = soapTextToEditorHtml(value);
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [value]);

  function emitFromDom() {
    const el = rootRef.current;
    if (!el) return;
    const html = sanitizeSoapHtml(el.innerHTML);
    const plain = soapHtmlToPlainText(html);
    // Keep plain storage when there's no formatting — easier for copy/paste & older consumers.
    onChange(/<(strong|b)\b/i.test(html) ? html : plain);
  }

  function runBold() {
    if (disabled) return;
    rootRef.current?.focus();
    document.execCommand('bold', false);
    emitFromDom();
  }

  return (
    <div className={`soap-rich${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}>
      <div className="soap-rich__bar" role="toolbar" aria-label="SOAP formatting">
        <button
          type="button"
          className="soap-rich__btn"
          disabled={disabled}
          title="Bold significant / abnormal findings"
          onClick={runBold}
        >
          <Bold size={14} /> Bold
        </button>
      </div>
      <div
        ref={rootRef}
        className="soap-rich__editor"
        style={{ minHeight: minHeightPx }}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        onInput={emitFromDom}
        onBlur={() => {
          emitFromDom();
          onBlur();
        }}
      />
    </div>
  );
}
