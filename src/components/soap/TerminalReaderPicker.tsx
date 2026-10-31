import { useEffect, useState } from 'react';
import {
  getTerminalReaders,
  selectTerminalReader,
  type TerminalReaderCatalog,
  type TerminalReaderOption,
} from '../../api/visitWorkflow';

type Props = {
  disabled?: boolean;
  className?: string;
  onCatalog?: (catalog: TerminalReaderCatalog) => void;
};

function apiErrorMessage(e: unknown): string {
  const res = (e as { response?: { data?: { message?: string | string[] } } })?.response;
  const message = res?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (message) return message;
  return e instanceof Error ? e.message : 'Could not load readers';
}

export default function TerminalReaderPicker({ disabled, className, onCatalog }: Props) {
  const [catalog, setCatalog] = useState<TerminalReaderCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const next = await getTerminalReaders();
        if (stopped) return;
        setCatalog(next);
        setError(null);
        onCatalog?.(next);
      } catch (e) {
        if (!stopped) setError(apiErrorMessage(e));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // Parent onCatalog identity should not restart the poller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = async (id: string) => {
    const reader = catalog?.readers.find((r) => r.id === id);
    if (!reader) return;
    setSaving(true);
    try {
      const next = await selectTerminalReader(reader);
      setCatalog(next);
      setError(null);
      onCatalog?.(next);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const selected = catalog?.readers.find((r) => r.id === catalog.selectedId) ?? null;

  return (
    <div className={className ?? 'soap-reader-picker'}>
      <label className="soap-reader-picker-label">
        Reader
        <select
          className="soap-input terminal-reader-select"
          value={catalog?.selectedId ?? ''}
          disabled={disabled || saving || !catalog}
          onChange={(e) => void onChange(e.target.value)}
        >
          <option value="">Select a reader…</option>
          {(catalog?.readers ?? []).map((reader) => (
            <option key={reader.id} value={reader.id}>
              {optionLabel(reader)}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="soap-hint">{error}</p> : null}
      {selected && !selected.online ? (
        <p className="soap-hint">
          {selected.kind === 'scout_terminal'
            ? 'That Scout Terminal is offline. Open the app on this account.'
            : 'That reader is offline. Check Starlink / power, then try again.'}
        </p>
      ) : null}
    </div>
  );
}

function optionLabel(reader: TerminalReaderOption): string {
  return `${reader.label}${reader.online ? '' : ' — offline'}`;
}
