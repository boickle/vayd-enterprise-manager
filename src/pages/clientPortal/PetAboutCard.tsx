import React, { useState } from 'react';
import type { PetPortalProfile, PetPortalProfilePatch } from '../../api/clientPortal';
import { CardHead } from './PortalPrimitives';
import type { PetWithWellness } from './portalShared';
import { possessive, speciesKind } from './portalShared';

type FactKey = 'nickname' | 'superpower' | 'favoriteThing' | 'nemesis' | 'keyToMyHeart' | 'funFact';

type FactDef = {
  key: FactKey;
  icon: string;
  label: string;
  tone: 'sun' | 'coral' | 'teal' | 'violet' | 'sky' | 'rose';
  prompt: (name: string, kind: 'dog' | 'cat' | 'other') => string;
  placeholder: (name: string, kind: 'dog' | 'cat' | 'other') => string;
  max: number;
  rows: number;
};

const FACTS: FactDef[] = [
  {
    key: 'nickname',
    icon: '🏷️',
    label: 'Also answers to',
    tone: 'teal',
    prompt: (n) => `What nicknames does ${n} go by?`,
    placeholder: (n, k) => (k === 'cat' ? `e.g. "${n} Bean", "Sir Floof"` : `e.g. "${n}ster", "Goober", "Boo Bear"`),
    max: 120,
    rows: 1,
  },
  {
    key: 'superpower',
    icon: '⚡',
    label: 'My superpower is',
    tone: 'sun',
    prompt: (n) => `What's ${possessive(n)} superpower?`,
    placeholder: (_n, k) =>
      k === 'cat' ? 'e.g. Teleporting onto the counter the second you look away' : 'e.g. Hearing the treat bag from three rooms away',
    max: 500,
    rows: 2,
  },
  {
    key: 'favoriteThing',
    icon: '💛',
    label: 'Favorite thing in the world',
    tone: 'violet',
    prompt: (n) => `What does ${n} love most?`,
    placeholder: (_n, k) => (k === 'cat' ? 'e.g. A sunbeam and a cardboard box' : 'e.g. Belly rubs, the beach, and peanut butter'),
    max: 500,
    rows: 2,
  },
  {
    key: 'nemesis',
    icon: '😾',
    label: 'My nemesis is',
    tone: 'coral',
    prompt: (n) => `Who (or what) is ${possessive(n)} sworn enemy?`,
    placeholder: (_n, k) => (k === 'cat' ? 'e.g. The vacuum cleaner. Always the vacuum.' : 'e.g. The mail carrier and that one squirrel'),
    max: 500,
    rows: 2,
  },
  {
    key: 'keyToMyHeart',
    icon: '🔑',
    label: 'The key to my heart is',
    tone: 'rose',
    prompt: (n) => `What's the key to ${possessive(n)} heart?`,
    placeholder: (_n, k) =>
      k === 'cat' ? 'e.g. Tuna. Chin scratches. Being left alone (on my terms).' : 'e.g. Cheese. Any cheese. All the cheese.',
    max: 500,
    rows: 2,
  },
  {
    key: 'funFact',
    icon: '✨',
    label: 'Fun fact',
    tone: 'sky',
    prompt: (n) => `Anything else we should know about ${n}?`,
    placeholder: () => 'e.g. Snores louder than grandpa. Has never once caught a ball.',
    max: 1000,
    rows: 3,
  },
];

function emptyProfile(): PetPortalProfile {
  return {
    nickname: null,
    favoriteThing: null,
    superpower: null,
    nemesis: null,
    funFact: null,
    keyToMyHeart: null,
    socialMediaConsent: false,
    socialMediaConsentAt: null,
    portalProfileUpdatedAt: null,
    color: null,
    weight: null,
    microchip: null,
  };
}

export default function PetAboutCard({
  pet,
  onSave,
  className,
  autoEdit = null,
}: {
  pet: PetWithWellness;
  onSave: (pet: PetWithWellness, patch: PetPortalProfilePatch) => Promise<void>;
  className?: string;
  /** Open this fact's editor on mount (e.g. "+ add a nickname" from the hero). */
  autoEdit?: FactKey | null;
}) {
  const profile = pet.portalProfile ?? emptyProfile();
  const kind = speciesKind(pet);
  const [editing, setEditing] = useState<FactKey | null>(autoEdit);
  const [draft, setDraft] = useState(autoEdit ? profile[autoEdit] ?? '' : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The parent keys this card by pet id, so switching pets remounts (and resets) the editor.

  const filled = FACTS.filter((f) => profile[f.key]).length;

  function startEdit(key: FactKey) {
    setEditing(key);
    setDraft(profile[key] ?? '');
    setError(null);
  }

  async function save() {
    if (!editing) return;
    const def = FACTS.find((f) => f.key === editing)!;
    const value = draft.trim().slice(0, def.max);
    setSaving(true);
    setError(null);
    try {
      await onSave(pet, { [editing]: value || null } as PetPortalProfilePatch);
      setEditing(null);
      setDraft('');
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const editingDef = editing ? FACTS.find((f) => f.key === editing) : null;

  return (
    <section className={`pp-card pp-card--tint${className ? ` ${className}` : ''}`} aria-label={`All about ${pet.name}`}>
      <CardHead
        icon="🐾"
        title={`All about ${pet.name}`}
        sub={
          filled === FACTS.length
            ? `We know ${pet.name} well — thanks for sharing!`
            : filled === 0
            ? `Tell us what makes ${pet.name} one of a kind. Tap any card.`
            : `${FACTS.length - filled} more to go — tap a card to fill it in.`
        }
      />

      <div className="pp-facts">
        {FACTS.map((f) => {
          const value = profile[f.key];
          if (editing === f.key && editingDef) {
            return (
              <div key={f.key} className="pp-fact-editor pp-pop">
                <div className="pp-fact-label">
                  <span>{f.icon}</span>
                  <span>{f.prompt(pet.name, kind)}</span>
                </div>
                <textarea
                  autoFocus
                  rows={f.rows}
                  maxLength={f.max}
                  value={draft}
                  placeholder={f.placeholder(pet.name, kind)}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || f.rows === 1)) {
                      e.preventDefault();
                      void save();
                    }
                  }}
                />
                {error ? <div className="pp-error">{error}</div> : null}
                <div className="pp-editor-row">
                  <span className="pp-count">
                    {draft.length}/{f.max}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="pp-btn pp-btn--ghost pp-btn--sm"
                      onClick={() => {
                        setEditing(null);
                        setError(null);
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    {value ? (
                      <button
                        type="button"
                        className="pp-btn pp-btn--ghost pp-btn--sm"
                        disabled={saving}
                        onClick={() => {
                          setDraft('');
                          void (async () => {
                            setSaving(true);
                            try {
                              await onSave(pet, { [f.key]: null } as PetPortalProfilePatch);
                              setEditing(null);
                            } catch (e: any) {
                              setError(e?.message || 'Could not clear.');
                            } finally {
                              setSaving(false);
                            }
                          })();
                        }}
                      >
                        Clear
                      </button>
                    ) : null}
                    <button type="button" className="pp-btn pp-btn--primary pp-btn--sm" onClick={() => void save()} disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <button
              key={f.key}
              type="button"
              className={`pp-fact pp-fact--${f.tone}`}
              onClick={() => startEdit(f.key)}
              aria-label={`${f.label}: ${value || 'not set yet'}. Tap to edit.`}
            >
              <span className="pp-fact-edit">{value ? 'Edit' : '+ Add'}</span>
              <span className="pp-fact-label">
                <span>{f.icon}</span>
                <span>{f.label}</span>
              </span>
              <span className={`pp-fact-value${value ? '' : ' pp-fact-value--empty'}`}>
                {value ? (f.key === 'nickname' ? `"${value}"` : value) : f.placeholder(pet.name, kind)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
