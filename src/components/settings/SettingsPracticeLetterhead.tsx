import { useEffect, useState } from 'react';
import {
  loadPracticeLetterhead,
  readImageAsLabelPng,
  savePracticeLetterhead,
} from '../../utils/practiceLetterhead';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export default function SettingsPracticeLetterhead() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let canceled = false;
    void loadPracticeLetterhead(PRACTICE_ID)
      .then((letterhead) => {
        if (canceled) return;
        setName(letterhead.name);
        setPhone(letterhead.phone);
        setAddress(letterhead.address);
        setLogoDataUrl(letterhead.logoDataUrl);
      })
      .catch((e) => {
        if (!canceled) setError(e instanceof Error ? e.message : 'Could not load practice letterhead.');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSaved(false);
    try {
      setLogoDataUrl(await readImageAsLabelPng(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the logo.');
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await savePracticeLetterhead({ name, phone, address, logoDataUrl }, PRACTICE_ID);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save practice letterhead.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <div className="settings-spinner" />
        <span>Loading practice letterhead…</span>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Practice</h2>
      <p className="settings-section-description">
        Name, phone, address, and logo printed on prescription labels. This is the practice
        letterhead — not an individual office address under Branches.
      </p>
      <div className="settings-card">
        {error ? <p className="settings-message settings-error-message">{error}</p> : null}
        {saved ? <p className="settings-message settings-success-message">Saved.</p> : null}
        <label className="settings-label">
          Practice name
          <input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="settings-label">
          Phone
          <input className="settings-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="settings-label">
          Address
          <input
            className="settings-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street or P.O. Box · City, ST ZIP"
          />
        </label>
        <div className="settings-label" style={{ marginTop: 12 }}>
          <span>Logo on Rx labels</span>
          <input
            className="settings-input"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => void onLogo(e.target.files?.[0])}
          />
          {logoDataUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <img
                src={logoDataUrl}
                alt="Practice logo"
                style={{ display: 'block', maxHeight: 56, maxWidth: 56, background: '#fff' }}
              />
              <button type="button" className="btn secondary" onClick={() => setLogoDataUrl(null)}>
                Remove logo
              </button>
            </div>
          ) : (
            <p className="settings-muted" style={{ marginTop: 6 }}>
              PNG or JPEG. Converted to black and white for the thermal printer. If you skip this,
              labels use the built-in Vet At Your Door mark.
            </p>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save letterhead'}
          </button>
        </div>
      </div>
    </div>
  );
}
