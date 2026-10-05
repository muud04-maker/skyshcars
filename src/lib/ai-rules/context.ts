/*
  Conversation context for the reply (Part 5, pure + testable).
  Only the LAST 25 messages of THIS conversation are used, labelled so the model can tell who said
  what. Staff messages ([STAFF]) are included and override the AI.
*/

export type CtxMsg = { sender?: string | null; body?: any; direction?: string | null };
export type SpeakerLabel = '[CUSTOMER]' | '[STAFF]' | '[AI]' | '[SYSTEM]';

export const CONTEXT_LIMIT = 25;

export function labelOf(m: CtxMsg): SpeakerLabel {
  const s = String(m?.sender || '').toLowerCase();
  if (s === 'customer') return '[CUSTOMER]';
  if (s === 'human' || s === 'staff' || s === 'admin') return '[STAFF]';
  if (s === 'system') return '[SYSTEM]';
  return '[AI]';
}

function clean(body: any) {
  return String(body == null ? '' : body).replace(/\s+/g, ' ').trim();
}

/** The last `limit` messages as labelled one-liners, oldest first. */
export function transcriptLines(messages: CtxMsg[] = [], limit = CONTEXT_LIMIT) {
  const n = Math.max(1, Math.min(200, Number(limit) || CONTEXT_LIMIT));
  return messages.slice(-n).map(m => `${labelOf(m)} ${clean(m.body)}`.trim());
}

/** Simple role mapping for chat APIs: the customer is the user, everyone else is the assistant. */
export function roleOf(m: CtxMsg): 'user' | 'assistant' {
  return String(m?.sender || '').toLowerCase() === 'customer' ? 'user' : 'assistant';
}
