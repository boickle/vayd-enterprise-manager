export type AppDialogKind = 'confirm' | 'alert' | 'prompt';

export type AppDialogOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  defaultValue?: string;
  placeholder?: string;
};

export type AppDialogRequest = AppDialogOptions & { kind: AppDialogKind };

type AppDialogHandler = (req: AppDialogRequest) => Promise<boolean | string | null>;

let handler: AppDialogHandler | null = null;

export function registerAppDialogHandler(next: AppDialogHandler | null): void {
  handler = next;
}

function asOptions(input: string | AppDialogOptions): AppDialogOptions {
  return typeof input === 'string' ? { message: input } : input;
}

function nativeFallback(req: AppDialogRequest): boolean | string | null {
  if (req.kind === 'alert') {
    window.alert(req.message);
    return true;
  }
  if (req.kind === 'prompt') {
    return window.prompt(req.message, req.defaultValue ?? '');
  }
  return window.confirm(req.message);
}

async function run(req: AppDialogRequest): Promise<boolean | string | null> {
  if (handler) return handler(req);
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
