import React, { useEffect, useState } from 'react';
import { getCurrentUser, updateCommunicationPreferences } from '../../api/users';
import { PortalModal } from './PortalPrimitives';

export default function PreferencesModal({
  onClose,
  fallbackInfo,
  onSaved,
}: {
  onClose: () => void;
  fallbackInfo?: any | null;
  onSaved?: () => void;
}) {
  const [allowEmail, setAllowEmail] = useState<boolean | null>(null);
  const [allowText, setAllowText] = useState<boolean | null>(null);
  const [preferPhone, setPreferPhone] = useState<boolean>(true);
  const [doNotSendReminders, setDoNotSendReminders] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getCurrentUser()
      .then((response) => {
        if (!alive) return;
        const user = response.data;
        setAllowEmail(user?.allowEmail ?? null);
        setAllowText(user?.allowText ?? null);
        setPreferPhone(user?.preferPhone !== false);
        setDoNotSendReminders(user?.doNotSendReminders === true);
      })
      .catch(() => {
        if (!alive || !fallbackInfo) return;
        setAllowEmail(fallbackInfo?.allowEmail ?? null);
        setAllowText(fallbackInfo?.allowText ?? null);
        setPreferPhone(fallbackInfo?.preferPhone !== false);
        setDoNotSendReminders(fallbackInfo?.doNotSendReminders === true);
      });
    return () => {
      alive = false;
    };
  }, [fallbackInfo]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateCommunicationPreferences(allowEmail ?? undefined, allowText ?? undefined, { preferPhone, doNotSendReminders });
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const Row = ({
    checked,
    onChange,
    title,
    desc,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    title: string;
    desc: string;
  }) => (
    <label className="pp-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <div className="pp-check-title">{title}</div>
        <div className="pp-check-desc">{desc}</div>
      </div>
    </label>
  );

  return (
    <PortalModal
      title="Communication preferences"
      onClose={onClose}
      labelledBy="pp-prefs-title"
      footer={
        <>
          <button type="button" className="pp-btn pp-btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="pp-btn pp-btn--primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <p className="pp-muted pp-small" style={{ margin: 0 }}>
        Choose how you&apos;d like to hear from us.
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        <Row
          checked={allowEmail === true}
          onChange={setAllowEmail}
          title="Email"
          desc="If you uncheck this, you will no longer receive any communications via email, including appointment and service reminders, appointment request confirmations, and anything else now or in the future managed through the client portal."
        />
        <Row
          checked={allowText === true}
          onChange={setAllowText}
          title="Text (SMS)"
          desc="If you uncheck this, you will no longer receive any communications via text, including appointment and service reminders, appointment request confirmations, and anything else now or in the future managed through the client portal."
        />
        <Row
          checked={preferPhone}
          onChange={setPreferPhone}
          title="Phone call"
          desc="We may call this number for scheduling or medical follow-up. Uncheck if you prefer we do not call."
        />
        <Row
          checked={doNotSendReminders}
          onChange={setDoNotSendReminders}
          title="Do not send reminders"
          desc="If you check this, we will not send appointment or health-care reminders by email or text."
        />
      </div>
      {error ? <div className="pp-error">{error}</div> : null}
    </PortalModal>
  );
}
