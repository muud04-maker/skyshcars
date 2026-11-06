/*
  Database side of the staff playbook (see ai-rules/staff-playbook.ts). Loads the last 180 days of
  customer + staff messages once, pairs questions with staff answers, and caches the result for
  15 minutes so a reply costs one in-memory search, not a query per message.
*/
import { rows } from './db';
import { buildPairs, similarPairs, playbookNote, type PlaybookPair } from './ai-rules/staff-playbook';

const TTL_MS = 15 * 60 * 1000;
let cache: { at: number; pairs: PlaybookPair[] } | null = null;
let loading: Promise<PlaybookPair[]> | null = null;

async function loadPairs(): Promise<PlaybookPair[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.pairs;
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await rows<any>(`SELECT id, conversation_id, sender, message_type, body, created_at FROM messages
        WHERE sender IN ('customer','human') AND body IS NOT NULL AND body<>''
          AND created_at >= (NOW() - INTERVAL 180 DAY)
        ORDER BY id DESC LIMIT 20000`);
      const pairs = buildPairs(r);
      cache = { at: Date.now(), pairs };
      return pairs;
    } catch {
      return cache?.pairs || [];
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Similar past questions with our staff answers (other chats only). Never throws. */
export async function staffReferences(query: string, conversationId?: number, k = 5): Promise<PlaybookPair[]> {
  try {
    if (!String(query || '').trim()) return [];
    return similarPairs(query, await loadPairs(), { k, excludeConversationId: conversationId });
  } catch { return []; }
}

export async function staffReferenceNote(query: string, conversationId?: number) {
  const refs = await staffReferences(query, conversationId);
  return { note: playbookNote(refs), refs };
}

/** Admin "AI Training" view: how many question/answer pairs the AI can learn from right now. */
export async function playbookSize() {
  try { return (await loadPairs()).length; } catch { return 0; }
}
