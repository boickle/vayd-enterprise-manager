import { useEffect, useState } from 'react';

type Kind = 'text' | 'email';

export function useUnsentComposeClose(open: boolean, onClose: () => void) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  return {
    confirming,
    requestClose: () => setConfirming(true),
    keepEditing: () => setConfirming(false),
    discard: () => {
      setConfirming(false);
      onClose();
    },
  };
}

export function ComposeCloseButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClick}
      disabled={disabled}
      style={{
        flexShrink: 0,
        width: 32,
        height: 32,
        margin: '-4px -4px 0 0',
        padding: 0,
        border: 'none',
        borderRadius: 8,
        background: 'transparent',
        color: '#374151',
        fontSize: 22,
        lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      ×
    </button>
  );
}

export function UnsentComposeConfirm({
  kind,
  onKeep,
  onDiscard,
}: {
  kind: Kind;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const noun = kind === 'email' ? 'email' : 'text';
  return (
    <div
      role="alertdialog"
      aria-labelledby="unsent-compose-confirm-title"
      style={{
        marginBottom: 16,
        padding: '12px 14px',
        background: '#fffbeb',
        border: '1px solid #fcd34d',
        borderRadius: 8,
      }}
    >
      <p
        id="unsent-compose-confirm-title"
        style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#78350f' }}
      >
        Are you sure you don&apos;t want to send this {noun}?
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn secondary" onClick={onKeep}>
          Keep editing
        </button>
        <button type="button" className="btn secondary" onClick={onDiscard}>
          Don&apos;t send
        </button>
      </div>
    </div>
  );
}
