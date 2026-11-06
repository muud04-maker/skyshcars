/*
  Staff playbook (pure + testable): learn from how OUR STAFF answered similar customer questions.

  The conversation history holds thousands of real customer questions with the staff reply that
  followed ("Where are you located?" -> "We are located in Guangzhou China", "Is shipping included?"
  -> "Shipping fee you will pay in your country"). For each new customer message we find the most
  similar past questions from OTHER chats and give the model the staff answers as references, so it
  answers like the team does instead of holding with "Let me confirm".

  Safety rules:
  - Broadcast/promo texts (the same staff text sent to 5+ chats) are never used as answers.
  - "[Staff sent a photo]" style labels are not answers.
  - Only pairs where the staff replied within 6 hours of the customer question.
  - References are style and business guidance; vehicle facts still come only from the database.
*/

export type PlaybookRow = { id: number; conversation_id: number; sender: string; message_type?: string | null; body: string | null; created_at: any };
export type PlaybookPair = { q: string; a: string; conversationId: number; tags: string[]; tokens: string[] };

const STOP = new Set(('a an the and or but is are was were be do does did have has had you your we our i me my it its this that these those ' +
  'what which who how can could would will please pls hi hello salam ok okay yes no not to of in on at for with from about just brother bro sir ' +
  'there here so also get want need like know tell send me give').split(' '));

/** Topic tags across the languages our customers use. */
const TAGS: [string, RegExp][] = [
  ['location', /\b(where|location|located|based|office|address|city|country are you)\b|o[uù] [eê]tes|onde|wapi|xagee|أين/i],
  ['price', /\b(price|prices|cost|how much|howmuch|combien|prix|quanto|pre[cç]o|bei|ngapi|meeqa|imisa|qiimo|chhal|last price|final price)\b|بكم|سعر/i],
  ['discount', /\b(discount|reduce|cheaper|negotiable|best price|too expensive|expensive|last price|r[ée]duction|desconto|punguzo)\b/i],
  ['shipping', /\b(ship|shipping|freight|deliver|delivery|port|transport|livraison|envio|usafirishaji|mombasa|lagos|tema|dar es salaam)\b/i],
  ['included', /\b(includ\w*|inclusive|cif|fob|all in)\b/i],
  ['payment', /\b(pay|payment|bank|transfer|deposit|western union|mpesa|m-pesa|paiement|pagamento|lipa)\b/i],
  ['photos', /\b(photos?|pictures?|pics?|images?|video|sawir|photo)\b|صور/i],
  ['available', /\b(available|still there|in stock|sold|disponible|dispon[ií]vel|ipo|ma haysaa)\b/i],
  ['documents', /\b(document|documents|papers|logbook|registration|customs|clearing|duty|tax)\b/i],
  ['visit', /\b(visit|come|see the car|inspect|inspection|agent)\b/i],
  ['time', /\b(how long|when|days|weeks|arrive|arrival|eta)\b/i],
  ['condition', /\b(condition|accident|mileage|km|engine|original|good)\b/i],
];

export function topicTags(text: unknown): string[] {
  const t = String(text == null ? '' : text);
  return TAGS.filter(([, re]) => re.test(t)).map(([k]) => k);
}

export function playbookTokens(text: unknown): string[] {
  return [...new Set(String(text == null ? '' : text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)))];
}

const isLabel = (b: string) => /^\[(staff sent|photo|image|voice|video|document|sent exact|unsupported)/i.test(b.trim());

/** Staff texts sent to `minChats`+ different conversations (promotions / broadcasts). */
export function broadcastBodies(rows: PlaybookRow[], minChats = 5): Set<string> {
  const chats = new Map<string, Set<number>>();
  for (const r of rows) {
    if (r.sender !== 'human' || !r.body) continue;
    const k = r.body.trim().slice(0, 120);
    if (!chats.has(k)) chats.set(k, new Set());
    chats.get(k)!.add(Number(r.conversation_id));
  }
  return new Set([...chats].filter(([, s]) => s.size >= minChats).map(([k]) => k));
}

const ms = (v: any) => { const x = v instanceof Date ? v.getTime() : Date.parse(String(v).replace(' ', 'T')); return Number.isFinite(x) ? x : 0; };

/** Pair each customer question with the staff reply that followed it (within 6 hours). */
export function buildPairs(rows: PlaybookRow[], opts: { maxGapMs?: number } = {}): PlaybookPair[] {
  const gap = opts.maxGapMs ?? 6 * 3600 * 1000;
  const broadcast = broadcastBodies(rows);
  const byChat = new Map<number, PlaybookRow[]>();
  for (const r of rows) {
    const id = Number(r.conversation_id);
    if (!byChat.has(id)) byChat.set(id, []);
    byChat.get(id)!.push(r);
  }
  const out: PlaybookPair[] = [];
  for (const [cid, list] of byChat) {
    list.sort((a, b) => Number(a.id) - Number(b.id));
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      const qb = String(q.body || '').trim();
      if (q.sender !== 'customer' || !qb || qb.length < 3 || qb.length > 300 || isLabel(qb)) continue;
      if (q.message_type && q.message_type !== 'text') continue;
      if (/^hello! can i get more info on this\??$/i.test(qb)) continue; // ad template: answered from the referral
      const answers: string[] = [];
      for (let j = i + 1; j < list.length; j++) {
        const r = list[j];
        if (r.sender === 'customer') break;
        if (r.sender !== 'human') continue;
        if (ms(r.created_at) - ms(q.created_at) > gap) break;
        const b = String(r.body || '').trim();
        if (!b || isLabel(b) || broadcast.has(b.slice(0, 120))) continue;
        answers.push(b);
        if (answers.join(' ').length > 400) break;
      }
      if (!answers.length) continue;
      out.push({ q: qb, a: answers.join(' / ').slice(0, 500), conversationId: cid, tags: topicTags(qb), tokens: playbookTokens(qb) });
    }
  }
  return out;
}

/** The k most similar past questions (excluding this chat). Similarity = shared topic tags + words. */
export function similarPairs(query: string, pairs: PlaybookPair[], opts: { k?: number; excludeConversationId?: number } = {}): PlaybookPair[] {
  const k = opts.k ?? 5;
  const qt = new Set(playbookTokens(query));
  const qtags = new Set(topicTags(query));
  if (!qt.size && !qtags.size) return [];
  const scored: { p: PlaybookPair; s: number }[] = [];
  for (const p of pairs) {
    if (opts.excludeConversationId && p.conversationId === opts.excludeConversationId) continue;
    const tagHits = p.tags.filter((t) => qtags.has(t)).length;
    const wordHits = p.tokens.filter((t) => qt.has(t)).length;
    // Need real evidence: a shared topic AND a shared word, two shared topics, or two shared words.
    if (!((tagHits >= 1 && wordHits >= 1) || tagHits >= 2 || wordHits >= 2)) continue;
    const union = new Set([...p.tokens, ...qt]).size || 1;
    const s = tagHits * 2 + (wordHits / union) * 3 + (tagHits && p.tags.length === qtags.size ? 0.5 : 0);
    scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s);
  // Prefer different answers: skip near-identical staff replies.
  const seen = new Set<string>();
  const out: PlaybookPair[] = [];
  for (const { p } of scored) {
    const key = p.a.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= k) break;
  }
  return out;
}

/** Prompt block for the model. */
export function playbookNote(pairs: PlaybookPair[]) {
  if (!pairs.length) return '';
  const lines = pairs.map((p, i) => `${i + 1}. Customer: "${p.q.replace(/\s+/g, ' ').slice(0, 160)}" -> Our staff answered: "${p.a.replace(/\s+/g, ' ').slice(0, 260)}"`);
  return ` HOW OUR STAFF ANSWERED SIMILAR QUESTIONS (real past chats with other customers). Answer the way our staff do - same facts about our business (location, shipping, payment, process), same short friendly tone. Vehicle prices, stock and photos still come ONLY from DATABASE FACTS; never copy a price or a vehicle from these examples. Do not reply "Let me confirm" when these answers already cover the question:\n${lines.join('\n')}`;
}
