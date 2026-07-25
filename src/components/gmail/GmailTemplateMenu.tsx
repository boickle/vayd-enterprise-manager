import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import type { GmailTemplate } from './gmailTemplates';

type Props = {
  templates: GmailTemplate[];
  /** Whether the current compose has content worth saving as a template. */
  canSave: boolean;
  disabled?: boolean;
  onInsert: (template: GmailTemplate) => void;
  onSaveNew: () => void;
  onOverwrite: (template: GmailTemplate) => void;
  onDelete: (template: GmailTemplate) => void;
};

/** Gmail-style Templates menu for the compose panel (insert / save / overwrite / delete). */
export default function GmailTemplateMenu({
  templates,
  canSave,
  disabled,
  onInsert,
  onSaveNew,
  onOverwrite,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<'overwrite' | 'delete' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setSection(null);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const hasTemplates = templates.length > 0;

  return (
    <div className="gmail-template-menu" ref={rootRef}>
      <button
        type="button"
        className={`gmail-btn gmail-template-menu__trigger${open ? ' gmail-template-menu__trigger--active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Templates"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <FileText size={14} strokeWidth={1.75} aria-hidden />
        Templates
      </button>

      {open ? (
        <div className="gmail-template-menu__dropdown" role="menu" aria-label="Templates">
          <div className="gmail-template-menu__section-title">Insert template</div>
          {hasTemplates ? (
            <ul className="gmail-template-menu__list">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="gmail-template-menu__item"
                    title={t.name}
                    onClick={() => {
                      onInsert(t);
                      close();
                    }}
                  >
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="gmail-template-menu__empty">No templates yet</div>
          )}

          <div className="gmail-template-menu__divider" />

          <button
            type="button"
            className="gmail-template-menu__item gmail-template-menu__item--action"
            disabled={!canSave}
            title={canSave ? undefined : 'Add a subject or message first'}
            onClick={() => {
              onSaveNew();
              close();
            }}
          >
            Save as new template
          </button>

          {hasTemplates ? (
            <>
              <button
                type="button"
                className="gmail-template-menu__item gmail-template-menu__item--expand"
                disabled={!canSave}
                aria-expanded={section === 'overwrite'}
                onClick={() => setSection((s) => (s === 'overwrite' ? null : 'overwrite'))}
              >
                <span>Overwrite template</span>
                <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
              </button>
              {section === 'overwrite' ? (
                <ul className="gmail-template-menu__sublist">
                  {templates.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className="gmail-template-menu__item"
                        onClick={() => {
                          onOverwrite(t);
                          close();
                        }}
                      >
                        {t.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <button
                type="button"
                className="gmail-template-menu__item gmail-template-menu__item--expand"
                aria-expanded={section === 'delete'}
                onClick={() => setSection((s) => (s === 'delete' ? null : 'delete'))}
              >
                <span>Delete template</span>
                <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
              </button>
              {section === 'delete' ? (
                <ul className="gmail-template-menu__sublist">
                  {templates.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className="gmail-template-menu__item gmail-template-menu__item--danger"
                        onClick={() => {
                          onDelete(t);
                          close();
                        }}
                      >
                        {t.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
