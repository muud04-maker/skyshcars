/*
  Server-side customer-language resolution (Part 1).

  Level 1: deterministic (script + Somali + English) via ai-rules/language.ts.
  Level 2: conversation inheritance for short/ambiguous messages.
  Level 3: a tiny DeepSeek classifier (JSON only) when the text is Latin but undecided.

  Dynamic hold + welcome labels for languages we do not hardcode are generated once through DeepSeek
  and cached in `ai_language_labels` (additive table), so a customer in French/Swahili/... still gets
  a short hold line and the website/group invitation in their own language.
*/
import axios from 'axios';
import { db, one } from './db';
import { getState, saveSlots } from './conversation-state';
import { DEFAULT_GROUP_LINK, DEFAULT_GROUP_NAME } from './ai-rules/welcome';
import { detectLanguageCode, isHardcodedLang, languageName, needsModelClassification, parseClassifierResult, preferredToCode } from './ai-rules/language';

const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '');

let ready: Promise<void> | null = null;
function ensureLabels() {
  if (!ready) ready = db().execute(`CREATE TABLE IF NOT EXISTS ai_language_labels(
    lang VARCHAR(12) NOT NULL PRIMARY KEY,
    hold_text VARCHAR(200) NULL,
    site_line VARCHAR(300) NULL,
    group_line VARCHAR(400) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

async function deepseek(messages: any[], maxTokens = 60): Promise<string | null> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  try {
    const r = await axios.post('https://api.deepseek.com/chat/completions',
      { model: MODEL, temperature: 0, max_tokens: maxTokens, messages },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return r.data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e: any) { console.error('LANG_MODEL_FAILED', e?.response?.status || e?.message || e); return null; }
}

/** Ask the model for the language only (tiny JSON answer, no prose). */
export async function classifyLanguage(text: string): Promise<string | null> {
  const raw = await deepseek([
    { role: 'system', content: 'You identify the language of a customer message. Reply with ONLY this JSON: {"language_code":"<ISO 639-1>","language_name":"<English name>","confidence":<0-1>}. No prose.' },
    { role: 'user', content: String(text || '').slice(0, 400) },
  ], 60);
  const parsed = parseClassifierResult(String(raw || ''));
  return parsed ? parsed.code : null;
}

/** Resolve the language to answer in: latest -> classifier -> explicit admin preference -> recent -> English. */
export async function detectCustomerLanguage(input: { conversationId?: number; latest?: string | null; recent?: string | null; preferred?: string | null }): Promise<string> {
  const latest = String(input.latest || '');
  const quick = detectLanguageCode(latest);
  if (quick) return quick;
  if (needsModelClassification(latest)) {
    const code = await classifyLanguage(latest);
    if (code) return code;
  }
  const pref = preferredToCode(input.preferred);
  if (pref) return pref;
  const recent = detectLanguageCode(String(input.recent || ''));
  if (recent) return recent;
  return 'en';
}

/** Explicit admin preference for this conversation (customers.preferred_language). */
export async function preferredLanguageOf(conversationId?: number) {
  if (!conversationId) return null;
  try {
    const r = await one<any>('SELECT c.preferred_language FROM conversations co LEFT JOIN customers c ON c.id=co.customer_id WHERE co.id=? LIMIT 1', [conversationId]);
    return r?.preferred_language || null;
  } catch { return null; }
}

/** Remember the language we detected (additive: conversation_state.slots.detected_language). */
export async function saveDetectedLanguage(conversationId: number | undefined, code: string) {
  if (!conversationId || !code) return;
  try { const st = await getState(conversationId); await saveSlots(conversationId, { ...((st as any).slots || {}), detected_language: code }); } catch {}
}

async function cachedLabel(lang: string) {
  try { await ensureLabels(); return await one<any>('SELECT hold_text,site_line,group_line FROM ai_language_labels WHERE lang=? LIMIT 1', [lang]); }
  catch { return null; }
}

const HOLD_FALLBACK: Record<string, string> = { en: 'Let me confirm that for you.', so: 'Waan kuu xaqiijinayaa.', ar: '\u062f\u0639\u0646\u064a \u0623\u062a\u0623\u0643\u062f \u0644\u0643.', zh: '\u6211\u5e2e\u4f60\u786e\u8ba4\u4e00\u4e0b\u3002' };

/** Short "let me confirm" line in the customer's language (hardcoded when possible, else model + cache). */
export async function holdTextFor(lang: string): Promise<string> {
  const code = String(lang || 'en').toLowerCase();
  if (isHardcodedLang(code)) return HOLD_FALLBACK[code] || HOLD_FALLBACK.en;
  const cached = await cachedLabel(code);
  if (cached?.hold_text) return String(cached.hold_text);
  const raw = await deepseek([
    { role: 'system', content: 'Translate ONE short sentence into the requested language. Reply with ONLY the translated sentence, no quotes, no explanation.' },
    { role: 'user', content: `Translate into ${languageName(code)}: "Let me confirm that for you."` },
  ], 40);
  const text = String(raw || '').replace(/^["']|["']$/g, '').trim().slice(0, 200);
  if (text) { try { await ensureLabels(); await db().execute('INSERT INTO ai_language_labels(lang,hold_text) VALUES(?,?) ON DUPLICATE KEY UPDATE hold_text=VALUES(hold_text)', [code, text]); } catch {} return text; }
  return HOLD_FALLBACK.en;
}

/** The two welcome lines (website + group) in the customer's language. URLs are never translated. */
export async function welcomeLinesFor(lang: string): Promise<{ site: string; group: string }> {
  const code = String(lang || 'en').toLowerCase();
  const site = SITE();
  const groupLink = DEFAULT_GROUP_LINK;
  const groupName = DEFAULT_GROUP_NAME;
  const en = { site: `See more vehicles: ${site}`, group: `Join our WhatsApp group: ${groupLink}` };
  if (code === 'en') return en;
  if (isHardcodedLang(code)) {
    const { welcomeBlock } = await import('./ai-rules/welcome');
    const lines = welcomeBlock(code as any, { enabled: true, site, groupLink, groupName }).split('\n');
    return { site: lines[0] || en.site, group: lines[1] || en.group };
  }
  const cached = await cachedLabel(code);
  if (cached?.site_line && cached?.group_line) return { site: String(cached.site_line), group: String(cached.group_line) };
  const raw = await deepseek([
    { role: 'system', content: 'You translate two very short UI lines. Reply with ONLY JSON: {"site":"...","group":"..."}. Keep URLs exactly as given and do not translate them.' },
    { role: 'user', content: `Translate into ${languageName(code)}:\n1) "See more vehicles: ${site}"\n2) "Join our WhatsApp group: ${groupLink}"` },
  ], 160);
  try {
    const j = JSON.parse(String(raw || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
    const s = String(j?.site || '').trim();
    const g = String(j?.group || '').trim();
    if (s && g) {
      try { await ensureLabels(); await db().execute('INSERT INTO ai_language_labels(lang,site_line,group_line) VALUES(?,?,?) ON DUPLICATE KEY UPDATE site_line=VALUES(site_line),group_line=VALUES(group_line)', [code, s.slice(0, 300), g.slice(0, 400)]); } catch {}
      return { site: s, group: g };
    }
  } catch { /* fall through */ }
  return en;
}
