import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  registerAppDialogHandler,
  type AppDialogRequest,
} from '../utils/appDialog';
import './AppDialog.css';

type Queued = {
  req: AppDialogRequest;
  resolve: (value: boolean | string | null) => void;
};

export default function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<Queued | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const queueRef = useRef<Queued[]>([]);
  const showingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const present = (item: Queued) => {
    showingRef.current = true;
    setPromptValue(item.req.defaultValue ?? '');
    setActive(item);
  };

  const finish = (value: boolean | string | null) => {
    active?.resolve(value);
    const next = queueRef.current.shift();
    if (next) present(next);
    else {
      showingRef.current = false;
      setActive(null);
    }
  };

  useEffect(() => {
    registerAppDialogHandler((req) => {
      return new Promise((resolve) => {
        const item = { req, resolve };
        if (showingRef.current) queueRef.current.push(item);
        else present(item);
      });
    });
    return () => registerAppDialogHandler(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(active.req.kind === 'alert' ? true : active.req.kind === 'prompt' ? null : false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (active.req.kind === 'prompt') {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    const sel = document.querySelector<HTMLButtonElement>(
      active.req.kind === 'alert' || !active.req.danger
        ? '.app-dialog__btn--primary, .app-dialog__btn--danger'
        : '.app-dialog__btn:not(.app-dialog__btn--primary):not(.app-dialog__btn--danger)',
    );
    sel?.focus();
  }, [active]);

  const req = active?.req;
  const multiline = (req?.message.length ?? 0) > 80 || (req?.message.includes('\n') ?? false);

  return (
    <>
      {children}
      {req
        ? createPortal(
            <div
              className="app-dialog-backdrop"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget && req.kind !== 'alert') {
                  finish(req.kind === 'prompt' ? null : false);
                }
              }}
            >
              <div
                className="app-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="app-dialog-title"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <h2 id="app-dialog-title" className="app-dialog__title">
                  {req.title ??
                    (req.kind === 'alert' ? 'Notice' : req.kind === 'prompt' ? 'Enter a value' : 'Please confirm')}
                </h2>
                <p className="app-dialog__body">{req.message}</p>
                {req.kind === 'prompt' ? (
                  multiline ? (
                    <textarea
                      ref={(el) => {
                        inputRef.current = el;
                      }}
                      className="app-dialog__field"
                      rows={3}
                      value={promptValue}
                      placeholder={req.placeholder}
                      onChange={(e) => setPromptValue(e.target.value)}
                    />
                  ) : (
                    <input
                      ref={(el) => {
                        inputRef.current = el;
                      }}
                      className="app-dialog__field"
                      value={promptValue}
                      placeholder={req.placeholder}
                      onChange={(e) => setPromptValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          finish(promptValue);
                        }
                      }}
                    />
                  )
                ) : null}
                <div className="app-dialog__actions">
                  {req.kind !== 'alert' ? (
                    <button
                      type="button"
                      className="app-dialog__btn"
                      onClick={() => finish(req.kind === 'prompt' ? null : false)}
                    >
                      {req.cancelLabel ?? 'Cancel'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`app-dialog__btn${
                      req.danger ? ' app-dialog__btn--danger' : ' app-dialog__btn--primary'
                    }`}
                    onClick={() => finish(req.kind === 'prompt' ? promptValue : true)}
                  >
                    {req.confirmLabel ?? (req.kind === 'alert' ? 'OK' : req.danger ? 'Continue' : 'OK')}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
