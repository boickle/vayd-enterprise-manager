import { useEffect, useRef, type Ref } from 'react';
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Underline } from 'lucide-react';
import { appPrompt } from '../../utils/appDialog';
import './MessageTemplateHtmlEditor.css';

export type HtmlEditorHandle = {
  insertText: (text: string) => void;
};

type Props = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  editorHandleRef?: Ref<HtmlEditorHandle | null>;
};

function assignHandle(ref: Ref<HtmlEditorHandle | null> | undefined, handle: HtmlEditorHandle | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(handle);
  else ref.current = handle;
}

export default function MessageTemplateHtmlEditor({
  value,
  onChange,
  disabled,
  placeholder = 'Write the email. Click a parameter to nest it.',
  editorHandleRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const next = value || '';
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [value]);

  useEffect(() => {
    const insertText = (text: string) => {
      const el = rootRef.current;
      if (!el || disabled) return;
      el.focus();
      document.execCommand('insertText', false, text);
      onChange(el.innerHTML);
    };
    assignHandle(editorHandleRef, { insertText });
    return () => assignHandle(editorHandleRef, null);
  }, [disabled, editorHandleRef, onChange]);

  function run(command: string, arg?: string) {
    if (disabled) return;
    rootRef.current?.focus();
    document.execCommand(command, false, arg);
    const html = rootRef.current?.innerHTML ?? '';
    onChange(html);
  }

  async function addLink() {
    const url = await appPrompt({
      title: 'Add link',
      message: 'Link address',
      placeholder: 'https://',
      confirmLabel: 'Add',
    });
    if (!url?.trim()) return;
    run('createLink', url.trim());
  }

  return (
    <div className={`msg-html${disabled ? ' is-disabled' : ''}`}>
      <div className="msg-html__bar" role="toolbar" aria-label="Email formatting">
        <button type="button" disabled={disabled} title="Bold" onClick={() => run('bold')}>
          <Bold size={14} />
        </button>
        <button type="button" disabled={disabled} title="Italic" onClick={() => run('italic')}>
          <Italic size={14} />
        </button>
        <button type="button" disabled={disabled} title="Underline" onClick={() => run('underline')}>
          <Underline size={14} />
        </button>
        <span className="msg-html__sep" />
        <button type="button" disabled={disabled} title="Bullets" onClick={() => run('insertUnorderedList')}>
          <List size={14} />
        </button>
        <button
          type="button"
          disabled={disabled}
          title="Numbered list"
          onClick={() => run('insertOrderedList')}
        >
          <ListOrdered size={14} />
        </button>
        <button type="button" disabled={disabled} title="Link" onClick={() => void addLink()}>
          <LinkIcon size={14} />
        </button>
      </div>
      <div
        ref={rootRef}
        className="msg-html__edit"
        contentEditable={disabled ? 'false' : 'true'}
        role="textbox"
        aria-multiline="true"
        aria-label="Email message"
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={() => {
          onChange(rootRef.current?.innerHTML ?? '');
        }}
      />
    </div>
  );
}
