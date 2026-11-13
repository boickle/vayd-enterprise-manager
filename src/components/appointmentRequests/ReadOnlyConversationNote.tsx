import type { ReactNode } from 'react';

/**
 * Where the conversation goes, for techs and doctors: they see the list read-only, and texts and
 * call transcripts are only for the people who work requests (SCH-R14; owner, Nov 13, 2026).
 */
export function ReadOnlyConversationNote({ children }: { children?: ReactNode }) {
  return (
    <section className="req-convo" aria-label="Conversation">
      <p className="settings-muted" style={{ margin: 0 }}>
        View only. Client liaisons and managers handle the conversation with the family.
      </p>
      {children ? <div className="req-convo-actions">{children}</div> : null}
    </section>
  );
}
