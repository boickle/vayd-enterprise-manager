import { useEffect, useState } from 'react';
import { getPracticeSettings, updatePracticeSettings } from '../../api/practiceSettings';

/** Practice setting key; the API reads the same key (calls.dockStartsOn). */
export const CALL_DOCK_STARTS_ON_KEY = 'calls.dockStartsOn' as const;

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

type Props = {
  practiceId: number;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

/**
 * Go-live (owner, Nov 11, 2026): calls that started before this date never reach anyone's call
 * dock, the unlinked-caller note on Settings → Staff, or unfiled-call tasks. They stay in each
 * chart's call history. Set it to go-live day so staff start with an empty dock.
 */
export default function SettingsCallDock({ practiceId, onMessage }: Props) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPracticeSettings(practiceId)
      .then((s) => {
        if (cancelled) return;
        const v = typeof s?.[CALL_DOCK_STARTS_ON_KEY] === 'string' ? String(s[CALL_DOCK_STARTS_ON_KEY]) : '';
        setValue(v);
        setSaved(v);
      })
      .catch((e) => onMessage?.(extractErr(e), 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, onMessage]);

  const save = async () => {
    setSaving(true);
    try {
      await updatePracticeSettings(practiceId, { [CALL_DOCK_STARTS_ON_KEY]: value });
      setSaved(value);
      onMessage?.(value ? 'Call dock start date saved.' : 'Call dock start date cleared.', 'success');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="settings-muted">Loading…</p>;
  return (
    <div style={{ maxWidth: 560 }}>
      <label className="settings-label" htmlFor="call-dock-starts-on">
        Call dock starts on
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0 8px' }}>
        <input
          id="call-dock-starts-on"
          type="date"
          className="settings-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className="btn" disabled={saving || value === saved} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {value ? (
          <button type="button" className="btn secondary" disabled={saving} onClick={() => setValue('')}>
            Clear
          </button>
        ) : null}
      </div>
      <p className="settings-muted" style={{ margin: 0 }}>
        Calls that started before this date don’t appear in anyone’s call dock, in the Quo note on
        Settings → Staff, or as unfiled-call tasks. They stay in each chart’s call history. Set it to
        go-live day so everyone starts with an empty call dock. Leave it blank to show every call.
      </p>
    </div>
  );
}
