import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, FileText, Receipt } from 'lucide-react';
import {
  registerAppDialogHandler,
  type AppDialogRequest,
  type AccountCreditDialogResult,
  type DeclineHowResult,
} from '../utils/appDialog';
import './AppDialog.css';

type Queued = {
  req: AppDialogRequest;
  resolve: (value: boolean | string | null | DeclineHowResult | AccountCreditDialogResult) => void;
};

function parseCreditAmount(raw: string): number | null {
  const amount = Number(raw.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(amount) || amount < 0.01) return null;
  return amount;
}

export default function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<Queued | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [amountValue, setAmountValue] = useState('');
  const queueRef = useRef<Queued[]>([]);
  const showingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const present = (item: Queued) => {
    showingRef.current = true;
    setPromptValue(item.req.defaultValue ?? '');
    setAmountValue('');
    setActive(item);
  };

  const finish = (value: boolean | string | null | DeclineHowResult | AccountCreditDialogResult) => {
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
        finish(
          active.req.kind === 'alert'
            ? true
            : active.req.kind === 'prompt' ||
                active.req.kind === 'decline-how' ||
                active.req.kind === 'account-credit'
              ? null
              : false,
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (active.req.kind === 'decline-how') {
      if (active.req.requireReason) {
        inputRef.current?.focus();
        return;
      }
      document.querySelector<HTMLButtonElement>('.app-dialog__choice')?.focus();
      return;
    }
    if (active.req.kind === 'account-credit') {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
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
  const promptMultiline = (req?.message.length ?? 0) > 80 || (req?.message.includes('\n') ?? false);
  const reasonNeeded = Boolean(req?.requireReason);
  const reasonOk = !reasonNeeded || promptValue.trim().length > 0;
  const creditAmount = req?.kind === 'account-credit' ? parseCreditAmount(amountValue) : null;
  const accountCreditOk =
    req?.kind === 'account-credit' && creditAmount != null && promptValue.trim().length > 0;
  const itemName = req?.itemName?.trim();

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
                  finish(
                    req.kind === 'prompt' ||
                      req.kind === 'decline-how' ||
                      req.kind === 'account-credit'
                      ? null
                      : false,
                  );
                }
              }}
            >
              <div
                className={`app-dialog${req.kind === 'decline-how' ? ' app-dialog--decline-how' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="app-dialog-title"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {req.kind === 'decline-how' ? (
                  <>
                    <div className="app-dialog__lead">
                      <span className="app-dialog__icon" aria-hidden>
                        <Ban size={18} />
                      </span>
                      <div>
                        <h2 id="app-dialog-title" className="app-dialog__title">
                          {req.title ?? 'Decline this item?'}
                        </h2>
                        {itemName ? <p className="app-dialog__item">{itemName}</p> : null}
                      </div>
                    </div>
                    {req.message.trim() ? (
                      <p className="app-dialog__body">{req.message}</p>
                    ) : null}
                    <p className="app-dialog__hint">How should this be recorded?</p>
                    <div className="app-dialog__choices">
                      <button
                        type="button"
                        className="app-dialog__choice app-dialog__choice--chart"
                        disabled={!reasonOk}
                        onClick={() => finish({ recordOnChart: true, note: promptValue })}
                      >
                        <FileText size={18} aria-hidden />
                        <span>
                          <strong>Chart the decline</strong>
                          <em>Red declined line on the record and reminder list</em>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="app-dialog__choice app-dialog__choice--bill"
                        disabled={!reasonOk}
                        onClick={() => finish({ recordOnChart: false, note: promptValue })}
                      >
                        <Receipt size={18} aria-hidden />
                        <span>
                          <strong>Don&apos;t chart it</strong>
                          <em>Take it off today&apos;s bill only</em>
                        </span>
                      </button>
                    </div>
                    <label className="app-dialog__label" htmlFor="app-dialog-decline-note">
                      {reasonNeeded ? 'Reason' : 'Note'}
                      <span>{reasonNeeded ? 'Required' : 'Optional'}</span>
                    </label>
                    <textarea
                      id="app-dialog-decline-note"
                      ref={(el) => {
                        inputRef.current = el;
                      }}
                      className="app-dialog__field"
                      rows={3}
                      value={promptValue}
                      placeholder={
                        req.placeholder ??
                        (reasonNeeded ? 'Why aren’t you doing it today?' : 'Add a note')
                      }
                      onChange={(e) => setPromptValue(e.target.value)}
                    />
                    <div className="app-dialog__actions">
                      <button
                        type="button"
                        className="app-dialog__btn"
                        onClick={() => finish(null)}
                      >
                        {req.cancelLabel ?? 'Cancel'}
                      </button>
                    </div>
                  </>
                ) : req.kind === 'account-credit' ? (
                  <>
                    <h2 id="app-dialog-title" className="app-dialog__title">
                      {req.title ?? 'Account credit'}
                    </h2>
                    {req.message.trim() ? <p className="app-dialog__body">{req.message}</p> : null}
                    <label className="app-dialog__label" htmlFor="app-dialog-credit-amount">
                      Amount
                      <span>Required</span>
                    </label>
                    <input
                      id="app-dialog-credit-amount"
                      ref={(el) => {
                        inputRef.current = el;
                      }}
                      className="app-dialog__field app-dialog__field--tight"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amountValue}
                      placeholder="0.00"
                      onChange={(e) => setAmountValue(e.target.value)}
                    />
                    <label className="app-dialog__label" htmlFor="app-dialog-credit-reason">
                      Reason
                      <span>Required</span>
                    </label>
                    <textarea
                      id="app-dialog-credit-reason"
                      className="app-dialog__field app-dialog__field--tight"
                      rows={3}
                      value={promptValue}
                      placeholder={
                        req.placeholder ?? 'Professional courtesy, refund of a fee, …'
                      }
                      onChange={(e) => setPromptValue(e.target.value)}
                    />
                    <p className="app-dialog__footnote">Saved with your name on the account ledger.</p>
                    <div className="app-dialog__actions">
                      <button
                        type="button"
                        className="app-dialog__btn"
                        onClick={() => finish(null)}
                      >
                        {req.cancelLabel ?? 'Cancel'}
                      </button>
                      <button
                        type="button"
                        className="app-dialog__btn app-dialog__btn--primary"
                        disabled={!accountCreditOk}
                        onClick={() => {
                          if (!accountCreditOk || creditAmount == null) return;
                          finish({ amount: creditAmount, description: promptValue.trim() });
                        }}
                      >
                        {req.confirmLabel ?? 'Add credit'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 id="app-dialog-title" className="app-dialog__title">
                      {req.title ??
                        (req.kind === 'alert'
                          ? 'Notice'
                          : req.kind === 'prompt'
                            ? 'Enter a value'
                            : 'Please confirm')}
                    </h2>
                    <p className="app-dialog__body">{req.message}</p>
                    {req.kind === 'prompt' ? (
                      promptMultiline ? (
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
                            if (e.key === 'Enter' && reasonOk) {
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
                          onClick={() => finish(false)}
                        >
                          {req.cancelLabel ?? 'Cancel'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`app-dialog__btn${
                          req.danger ? ' app-dialog__btn--danger' : ' app-dialog__btn--primary'
                        }`}
                        disabled={req.kind === 'prompt' && !reasonOk}
                        onClick={() => {
                          if (req.kind === 'prompt' && !promptValue.trim()) return;
                          finish(req.kind === 'prompt' ? promptValue : true);
                        }}
                      >
                        {req.confirmLabel ??
                          (req.kind === 'alert' ? 'OK' : req.danger ? 'Continue' : 'OK')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
