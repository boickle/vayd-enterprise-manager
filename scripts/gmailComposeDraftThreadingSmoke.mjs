/**
 * Smoke: Scout Email reply draft autosave must keep Gmail threadId.
 * Mirrors helpers in src/components/gmail/gmailCompose.ts.
 *
 * Run: node scripts/gmailComposeDraftThreadingSmoke.mjs
 */

function buildComposeDraft(ctx) {
  if (ctx.mode === 'new') {
    return { threadId: ctx.threadId, inReplyTo: undefined, references: undefined };
  }
  if (!ctx.replyTo) {
    return { threadId: undefined, inReplyTo: undefined, references: undefined };
  }
  if (ctx.mode === 'forward') {
    return { threadId: undefined, inReplyTo: undefined, references: undefined };
  }
  const msgId = ctx.replyTo.headers?.messageId?.trim();
  const prior = ctx.replyTo.headers?.references?.trim();
  return {
    threadId: ctx.threadId ?? ctx.replyTo.threadId,
    inReplyTo: msgId || undefined,
    references: prior && msgId ? `${prior} ${msgId}` : msgId || prior || undefined,
  };
}

function loadComposeFromThreadDraft(threadMessages) {
  const draft = (threadMessages ?? []).find((m) => (m.labelIds ?? []).includes('DRAFT'));
  if (!draft) return null;
  return {
    draftId: draft.draftId?.trim() || draft.id,
    threadId: draft.threadId?.trim() || undefined,
    inReplyTo: draft.headers?.inReplyTo?.trim() || undefined,
    references: draft.headers?.references?.trim() || undefined,
  };
}

function resolveComposeThreading(ctx, threadMessages) {
  const built = buildComposeDraft(ctx);
  const existing = loadComposeFromThreadDraft(threadMessages);
  return {
    threadId:
      built.threadId?.trim() ||
      ctx.threadId?.trim() ||
      ctx.replyTo?.threadId?.trim() ||
      existing?.threadId?.trim() ||
      undefined,
    inReplyTo: built.inReplyTo?.trim() || existing?.inReplyTo?.trim() || undefined,
    references: built.references?.trim() || existing?.references?.trim() || undefined,
  };
}

function composeDraftThreadingReady(mode, fields) {
  if (mode !== 'reply' && mode !== 'replyAll') return true;
  return Boolean(fields.threadId?.trim());
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const parent = {
  id: 'msg-parent',
  threadId: 'thread-1622',
  labelIds: ['INBOX'],
  headers: {
    messageId: '<parent@mail.gmail.com>',
    references: '',
  },
};

const nativeDraft = {
  id: 'msg-draft',
  draftId: 'draft-r1',
  threadId: 'thread-1622',
  labelIds: ['DRAFT'],
  headers: {
    inReplyTo: '<parent@mail.gmail.com>',
    references: '<parent@mail.gmail.com>',
  },
};

// Late hydrate of a native Gmail draft (Scout Email auto-open) must keep threadId.
const fromDraftOnly = resolveComposeThreading({ mode: 'reply' }, [parent, nativeDraft]);
assert(fromDraftOnly.threadId === 'thread-1622', 'expected threadId from existing draft');
assert(fromDraftOnly.inReplyTo === '<parent@mail.gmail.com>', 'expected inReplyTo from draft');

// Context threadId wins even before aliases load.
const fromContext = resolveComposeThreading(
  { mode: 'reply', threadId: 'thread-1622', replyTo: parent },
  [],
);
assert(fromContext.threadId === 'thread-1622', 'expected threadId from context');
assert(fromContext.inReplyTo === '<parent@mail.gmail.com>', 'expected inReplyTo from replyTo');

// Autosave gate: reply without threadId must not save.
assert(
  composeDraftThreadingReady('reply', { threadId: undefined, inReplyTo: '<x>' }) === false,
  'reply without threadId must block autosave',
);
assert(
  composeDraftThreadingReady('reply', { threadId: 'thread-1622' }) === true,
  'reply with threadId must allow autosave',
);
assert(
  composeDraftThreadingReady('new', { threadId: undefined }) === true,
  'new compose may save without threadId',
);

console.log('gmailComposeDraftThreadingSmoke: ok');
