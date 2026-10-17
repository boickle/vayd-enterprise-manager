export type AppDialogKind = 'confirm' | 'alert' | 'prompt' | 'decline-how';

export type AppDialogOptions = {
  title?: string;
  message: string;
  /** Shown as the named item in decline-how (charge / plan line). */
  itemName?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  defaultValue?: string;
  placeholder?: string;
  requireReason?: boolean;
};

export type DeclineHowResult = { recordOnChart: boolean; note: string };

export type AppDialogRequest = AppDialogOptions & { kind: AppDialogKind };

type AppDialogResult = boolean | string | null | DeclineHowResult;

type AppDialogHandler = (req: AppDialogRequest) => Promise<AppDialogResult>;

type AppDialogStore = { handler: AppDialogHandler | null };

/** Survives Vite HMR of this module so we don't fall back to window.confirm. */
const store: AppDialogStore =
  ((globalThis as { __vaydAppDialogStore?: AppDialogStore }).__vaydAppDialogStore ??= {
    handler: null,
  });

export function registerAppDialogHandler(next: AppDialogHandler | null): void {
  store.handler = next;
}

function asOptions(input: string | AppDialogOptions): AppDialogOptions {
  return typeof input === 'string' ? { message: input } : input;
}

function nativeFallback(req: AppDialogRequest): AppDialogResult {
  if (req.kind === 'alert') {
    window.alert(req.message);
    return true;
  }
  if (req.kind === 'prompt') {
    return window.prompt(req.message, req.defaultValue ?? '');
  }
  if (req.kind === 'decline-how') {
    const chart = window.confirm(`${req.message}\n\nOK = chart the decline. Cancel = pick the other option.`);
    if (chart) {
      const note = window.prompt(req.placeholder ?? 'Optional note', req.defaultValue ?? '') ?? '';
      if (req.requireReason && !note.trim()) return null;
      return { recordOnChart: true, note };
    }
    const off = window.confirm('Decline without putting it on the patient record?');
    if (!off) return null;
    const note = window.prompt(req.placeholder ?? 'Optional note', req.defaultValue ?? '') ?? '';
    if (req.requireReason && !note.trim()) return null;
    return { recordOnChart: false, note };
  }
  return window.confirm(req.message);
}

async function run(req: AppDialogRequest): Promise<AppDialogResult> {
  if (store.handler) return store.handler(req);
  return nativeFallback(req);
}

export function appConfirm(input: string | AppDialogOptions): Promise<boolean> {
  return run({ kind: 'confirm', ...asOptions(input) }).then((v) => v === true);
}

export function appAlert(input: string | AppDialogOptions): Promise<void> {
  return run({ kind: 'alert', ...asOptions(input) }).then(() => undefined);
}

export function appPrompt(input: string | AppDialogOptions): Promise<string | null> {
  return run({ kind: 'prompt', ...asOptions(input) }).then((v) =>
    typeof v === 'string' ? v : null,
  );
}

export function appDeclineHow(input: AppDialogOptions): Promise<DeclineHowResult | null> {
  return run({ kind: 'decline-how', ...input }).then((v) =>
    v && typeof v === 'object' && 'recordOnChart' in v ? v : null,
  );
}
