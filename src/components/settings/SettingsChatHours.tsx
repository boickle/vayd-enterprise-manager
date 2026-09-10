import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  defaultChatHoursOfOperation,
  fetchChatHoursOfOperation,
  saveChatHoursOfOperation,
  type ChatHoursOfOperation,
} from '../../api/chatHoursOfOperation';
import {
  CHAT_DAY_LABELS,
  CHAT_DAY_NAMES,
  formatChatHoursLegalSummary,
  formatChatHoursSchedule,
  type ChatDayName,
} from '../../utils/chatHours';

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

export default function SettingsChatHours({ practiceId, onMessage }: Props) {
  const [hours, setHours] = useState<ChatHoursOfOperation>(defaultChatHoursOfOperation());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const previewSummary = useMemo(() => formatChatHoursLegalSummary(hours), [hours]);
  const previewSchedule = useMemo(() => formatChatHoursSchedule(hours), [hours]);

  const loadHours = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await fetchChatHoursOfOperation(practiceId);
      setHours(next);
    } catch (err) {
      setLoadError(extractErr(err));
      setHours(defaultChatHoursOfOperation());
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => {
    void loadHours();
  }, [loadHours]);

  const updateDay = (dayName: ChatDayName, patch: Partial<{ closed: boolean; open: string; close: string }>) => {
    setHours((prev) => {
      const next = { ...prev };
      if (patch.closed) {
        next[dayName] = null;
        return next;
      }

      const current = next[dayName] ?? { open: '08:00', close: '17:00' };
      next[dayName] = {
        open: patch.open ?? current.open,
        close: patch.close ?? current.close,
      };
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await saveChatHoursOfOperation(practiceId, hours);
      setHours(saved);
      onMessage?.('Live chat hours saved.', 'success');
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setHours(defaultChatHoursOfOperation());
  };

  return (
    <div className="settings-card">
      <h3 className="settings-card-title">Live chat hours</h3>
      <p className="settings-muted" style={{ marginBottom: 12 }}>
        Controls when members can open after-hours live chat in the Client Portal and the support
        hours shown in membership agreement copy.
      </p>

      {loadError && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
          {loadError}
          <button onClick={() => setLoadError(null)} className="settings-close" type="button">
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="settings-loading">
          <div className="settings-spinner"></div>
          <span>Loading chat hours...</span>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 10 }}>
            {CHAT_DAY_NAMES.map((dayName, index) => {
              const dayHours = hours[dayName];
              const isClosed = !dayHours?.open || !dayHours?.close;
              return (
                <div
                  key={dayName}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 90px 1fr 1fr',
                    gap: 10,
                    alignItems: 'center',
                  }}
                >
                  <strong>{CHAT_DAY_LABELS[index]}</strong>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={isClosed}
                      onChange={(e) => updateDay(dayName, { closed: e.target.checked })}
                    />
                    Closed
                  </label>
                  <div>
                    <label className="settings-label">Open</label>
                    <input
                      type="time"
                      className="settings-input"
                      value={dayHours?.open ?? '08:00'}
                      disabled={isClosed}
                      onChange={(e) => updateDay(dayName, { open: e.target.value, closed: false })}
                    />
                  </div>
                  <div>
                    <label className="settings-label">Close</label>
                    <input
                      type="time"
                      className="settings-input"
                      value={dayHours?.close ?? '17:00'}
                      disabled={isClosed}
                      onChange={(e) => updateDay(dayName, { close: e.target.value, closed: false })}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className="settings-card"
            style={{ marginTop: 16, background: '#f8fafc', border: '1px solid #e2e8f0' }}
          >
            <h4 className="settings-card-title" style={{ fontSize: 15 }}>Preview</h4>
            <p className="settings-muted" style={{ marginBottom: 8 }}>
              {previewSummary}
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {previewSchedule.map((line) => (
                <li key={line.day}>
                  {line.day}: {line.hours}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              type="button"
              className="settings-button settings-button-primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save chat hours'}
            </button>
            <button
              type="button"
              className="settings-button"
              onClick={handleResetDefaults}
              disabled={saving}
            >
              Reset to defaults
            </button>
          </div>
        </>
      )}
    </div>
  );
}
