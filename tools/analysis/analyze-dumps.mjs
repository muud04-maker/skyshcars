/*
  Read-only analysis of the production database exports (phpMyAdmin dumps).

  Usage:
    node tools/analysis/analyze-dumps.mjs --customers <customers.txt> --conversations <conversations.sql> --messages <messages.sql> [--days 14]

  It answers the questions in the AI-audit brief from REAL data: who asked what, what the AI answered,
  what staff answered, where the AI repeated itself or promised something it did not deliver, how the
  conversations ended up in human mode, and whether anything looks like a completed sale.

  Privacy: nothing here writes to the database, and the printed report never shows phone numbers,
  PSIDs, e-mail addresses, tokens or credentials - only ids, counts, masked message text and
  anonymised conversation references. Customer phone/PSID digits inside message bodies are masked.
*/
import { readFileSync } from 'node:fs';

const arg = (name, fallback = '') => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const CUSTOMERS = arg('customers', 'C:/Users/muud_/Downloads/customers.txt');
const CONVERSATIONS = arg('conversations', 'C:/Users/muud_/Downloads/conversations.sql');
const MESSAGES = arg('messages', 'C:/Users/muud_/Downloads/messages.sql');
const DAYS = Number(arg('days', '14')) || 14;
/** Sanitized dossiers for the conversations named in the brief (ids only, no PII). */
const DOSSIER = arg('dossier', '4,2,8,9,130,35,51').split(',').map((s) => Number(s.trim())).filter(Boolean);

// ---------------------------------------------------------------- parsing
/** phpMyAdmin "text" export: a structure block (|column|type|...) then data rows (|v|v|...). */
export function parsePipeDump(text) {
  const lines = String(text).split(/\r?\n/);
  const columns = [];
  let inStructure = false, inData = false;
  const rows = [];
  for (const line of lines) {
    if (/^== Table structure/i.test(line)) { inStructure = true; inData = false; continue; }
    if (/^== Dumping data/i.test(line)) { inStructure = false; inData = true; continue; }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1);
    if (inStructure) {
      if (cells[0] === 'Column') continue;
      if (cells.length >= 2 && !/^-+$/.test(cells[0])) columns.push(cells[0]);
      continue;
    }
    if (inData) rows.push(Object.fromEntries(cells.map((v, i) => [columns[i] || `c${i}`, v === 'NULL' ? null : v])));
  }
  return { columns, rows };
}

/** Parse `INSERT INTO \`table\` (cols) VALUES (...),(...);` blocks into objects. */
export function parseSqlInserts(text, table) {
  const src = String(text);
  const out = [];
  const re = new RegExp(`INSERT INTO\\s+\`${table}\`\\s*\\(([^)]*)\\)\\s*VALUES`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const cols = m[1].split(',').map((c) => c.trim().replace(/`/g, ''));
    // Walk the tuple list until the statement-ending semicolon at paren depth 0.
    let i = re.lastIndex, depth = 0, inStr = false, field = '', row = [];
    for (; i < src.length; i++) {
      const ch = src[i];
      if (inStr) {
        if (ch === '\\') { field += ch + (src[i + 1] || ''); i++; continue; }
        if (ch === "'") { if (src[i + 1] === "'") { field += "''"; i++; continue; } inStr = false; field += ch; continue; }
        field += ch; continue;
      }
      if (ch === "'") { inStr = true; field += ch; continue; }
      if (ch === '(') { depth++; if (depth === 1) { field = ''; row = []; continue; } }
      if (ch === ')') {
        depth--;
        if (depth === 0) { row.push(field); field = ''; out.push(Object.fromEntries(cols.map((c, k) => [c, cleanValue(row[k])]))); continue; }
      }
      if (ch === ',' && depth === 1) { row.push(field); field = ''; continue; }
      if (ch === ';' && depth === 0) { re.lastIndex = i + 1; break; }
      if (depth >= 1) field += ch;
    }
  }
  return out;
}

function cleanValue(raw) {
  if (raw == null) return null;
  let v = String(raw).trim();
  if (/^NULL$/i.test(v)) return null;
  if (v.startsWith("'") && v.endsWith("'")) {
    v = v.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return v;
  }
  return /^-?\d+$/.test(v) ? Number(v) : v;
}

// ---------------------------------------------------------------- helpers
const maskDigits = (s, min = 6) => String(s ?? '').replace(new RegExp(`\\d{${min},}`, 'g'), '<num>');
const clip = (s, n = 90) => { const t = maskDigits(String(s ?? '').replace(/\s+/g, ' ').trim()); return t.length > n ? t.slice(0, n) + '…' : t; };
const ts = (v) => { const t = v ? Date.parse(String(v).replace(' ', 'T')) : NaN; return Number.isFinite(t) ? t : 0; };
const day = (v) => (v ? String(v).slice(0, 10) : '');
const scriptOf = (s) => {
  const t = String(s || '');
  if (/[\u0600-\u06FF]/.test(t)) return 'ar';
  if (/[\u4e00-\u9fff]/.test(t)) return 'zh';
  if (/[\u0400-\u04FF]/.test(t)) return 'ru';
  if (/[a-z]/i.test(t)) return 'latin';
  return 'other';
};
const STOCKS = (s) => [...new Set([...String(s || '').matchAll(/\bSC[\s-]?0*(\d{1,6})\b/gi)].map((m) => 'SC' + String(m[1]).padStart(5, '0')))];
const BUDGET = /(?:under|below|less than|max|maximum|up to|budget(?:\s+is|\s+of)?|around|about)\s*\$?\s*(\d[\d,._]*)\s*(k\b|usd|\$)?|\$\s*(\d[\d,._]{2,})|(\d[\d,._]{2,})\s*(?:usd|dollars?)/i;
const MOTORCYCLE = /\b(motorcycles?|motorbikes?|bikes?|scooter|cbr|ninja|gsxr|hayabusa|r6|mt-?09|z1000)\b/i;
const CAR = /\b(cars?|suv|sedan|saloon|hatchback|pickup|truck|van)\b/i;
const ASK_PHOTO = /\b(photos?|pictures?|pics?|images?|sawir|video)\b/i;
const ASK_PRICE = /\b(price|cost|how much|qiimo|meeqa)\b|\$/i;
const ASK_SHIP = /\b(ship|shipping|freight|port|deliver|delivery|customs|clearance)\b/i;
const ASK_AVAIL = /\b(available|availability|in stock|still have|sold|reserved)\b/i;
const ASK_PAY = /\b(pay|payment|deposit|bank|invoice|transfer|order|purchase|buy)\b/i;
/* A promise to send photos NOW - deliberately different from an OFFER ("I can also send you: photos"). */
const AI_PROMISE_PHOTOS = /\b(?:i'?m |i am )?sending (?:you )?(?:the )?(?:photos?|pictures?|pics?|images?)\b|\bi'?ll send (?:you )?(?:the )?(?:photos?|pictures?|pics?|images?)\b|\bhere are (?:the )?(?:photos?|pictures?|images?)\b|\b(?:photos?|pictures?|images?) (?:are |were )?sent\b|\bsent (?:you )?(?:the )?(?:photos?|pictures?|pics?|images?)\b/i;
const AI_PHOTO_OFFER = /\b(?:i can (?:also )?send|i can share|want me to send|shall i send|would you like (?:me to send )?(?:the )?photos)\b/i;
const AI_DENY_PHOTOS = /\b(no|don't have|do not have|not have|without)\b[^.!?]{0,40}\b(exact )?(photos?|pictures?|images?)\b/i;
/* Only QUESTION forms count as repetition: the AI merely *mentioning* a known budget is not asking. */
const AI_ASK_BUDGET = /(?:what(?:'s| is)?|tell me|can you tell me|share|confirm)\s+(?:your\s+)?(?:budget|price range|maximum|max budget)|\bbudget\s*\?|how much (?:can|do|are) you (?:spend|afford|looking to spend)|what(?:'s| is) your (?:max|maximum)\b/i;
const AI_ASK_DEST = /(?:which|what)\s+(?:country|port|city)|\bwhere (?:should|shall|do|can) (?:we|i) ship|\bship(?:ping)? to (?:which|what)\b|\byour (?:country|port|destination)\s*\?/i;
const AI_ASK_VEHICLE = /(?:which|what)\s+(?:vehicle|car|bike|motorcycle|model)\b|\bwhich one do you mean\b|\bsend me the (?:model|stock|link)\b/i;
const HOLD = /\b(let me confirm|one moment|checking now|will confirm|team will|i will check|please wait)\b/i;
/* Only an explicit first-person confirmation counts - never generic marketing wording. */
const SALE_DONE = /(?:your|the)\s+(?:order|payment|deposit|invoice)\s+(?:is|has been|was)\s+(?:confirmed|received|paid)|we\s+(?:have\s+)?received\s+your\s+(?:payment|deposit)|you\s+(?:have\s+)?paid\b|your\s+(?:car|vehicle)\s+(?:has been|is)\s+(?:booked|loaded|shipped)/i;

function isQuestion(body) {
  const t = String(body || '');
  return /\?|^\s*(what|which|how|when|where|who|do you|can you|is it|are you|any)\b/i.test(t);
}
/** Did the customer already give this fact earlier in the conversation? */
export function priorFacts(customerTexts) {
  const budget = customerTexts.some((t) => BUDGET.test(t));
  const destination = customerTexts.some((t) => /\b(ship|shipping|deliver|send)\b/i.test(t) && /\b(to|in)\s+[A-Z][a-z]/i.test(t));
  const category = customerTexts.some((t) => MOTORCYCLE.test(t) || CAR.test(t));
  const vehicle = customerTexts.some((t) => STOCKS(t).length > 0 || /\b(19[89]\d|20[0-4]\d)\b/.test(t));
  return { budget, destination, category, vehicle };
}

// ---------------------------------------------------------------- report
function main() {
  const customers = parsePipeDump(readFileSync(CUSTOMERS, 'utf8')).rows;
  const conversations = parseSqlInserts(readFileSync(CONVERSATIONS, 'utf8'), 'conversations');
  const messages = parseSqlInserts(readFileSync(MESSAGES, 'utf8'), 'messages');

  messages.sort((a, b) => ts(a.created_at) - ts(b.created_at) || Number(a.id) - Number(b.id));
  const byConversation = new Map();
  for (const m of messages) {
    const k = Number(m.conversation_id);
    if (!byConversation.has(k)) byConversation.set(k, []);
    byConversation.get(k).push(m);
  }

  const line = (t) => console.log(t);
  line('SKY CARS - REAL CONVERSATION AUDIT (read-only, from the production dumps)');
  line(`customers=${customers.length} conversations=${conversations.length} messages=${messages.length}`);
  const senderCounts = {};
  for (const m of messages) senderCounts[m.sender] = (senderCounts[m.sender] || 0) + 1;
  line(`messages by sender: ${JSON.stringify(senderCounts)}`);
  const typeCounts = {};
  for (const m of messages) typeCounts[m.message_type] = (typeCounts[m.message_type] || 0) + 1;
  line(`messages by type: ${JSON.stringify(typeCounts)}`);

  // --- mode / handover
  const modes = {};
  for (const c of conversations) modes[c.mode] = (modes[c.mode] || 0) + 1;
  line('');
  line(`CONVERSATION MODES: ${JSON.stringify(modes)}`);
  const takeover = conversations.filter((c) => c.takeover_by);
  line(`conversations with takeover_by set: ${takeover.length} (distinct staff values: ${JSON.stringify([...new Set(takeover.map((c) => c.takeover_by))])})`);
  const byId = new Map(conversations.map((c) => [Number(c.id), c]));
  let aiAfterStaff = 0, staffAfterAi = 0, aiAnswered = 0, staffAnswered = 0, unanswered = 0;
  for (const [cid, list] of byConversation) {
    const conv = byId.get(cid);
    if (!conv) continue;
    const lastCustomer = [...list].reverse().find((m) => m.sender === 'customer');
    const lastOut = [...list].reverse().find((m) => m.direction === 'outbound' && ['ai', 'human'].includes(m.sender));
    if (list.some((m) => m.sender === 'ai')) aiAnswered++;
    if (list.some((m) => m.sender === 'human')) staffAnswered++;
    if (lastCustomer && (!lastOut || ts(lastOut.created_at) < ts(lastCustomer.created_at))) unanswered++;
    const lastHuman = [...list].reverse().find((m) => m.sender === 'human');
    if (lastHuman) {
      const after = list.filter((m) => m.sender === 'ai' && ts(m.created_at) > ts(lastHuman.created_at));
      if (after.length) aiAfterStaff++;
      else if (list.some((m) => m.sender === 'ai')) staffAfterAi++;
    }
  }
  line(`conversations answered by AI: ${aiAnswered} | answered by staff: ${staffAnswered} | customer left waiting (no reply after their last message): ${unanswered}`);
  line(`conversations where an AI reply came AFTER the last staff reply: ${aiAfterStaff} | where staff replied after the AI: ${staffAfterAi}`);

  // --- what customers asked, and how well the AI/staff answered
  const asks = { price: 0, photos: 0, shipping: 0, availability: 0, payment: 0, motorcycles: 0, cars: 0, question: 0, vehicleRef: 0 };
  let customerMsgs = 0;
  for (const m of messages) {
    if (m.sender !== 'customer') continue;
    customerMsgs++;
    const b = String(m.body || '');
    if (ASK_PRICE.test(b)) asks.price++;
    if (ASK_PHOTO.test(b)) asks.photos++;
    if (ASK_SHIP.test(b)) asks.shipping++;
    if (ASK_AVAIL.test(b)) asks.availability++;
    if (ASK_PAY.test(b)) asks.payment++;
    if (MOTORCYCLE.test(b)) asks.motorcycles++;
    if (CAR.test(b)) asks.cars++;
    if (isQuestion(b)) asks.question++;
    if (STOCKS(b).length) asks.vehicleRef++;
  }
  line('');
  line(`CUSTOMER MESSAGES: ${customerMsgs}`);
  line(`  price ${asks.price} | photos ${asks.photos} | shipping ${asks.shipping} | availability ${asks.availability} | payment/order ${asks.payment}`);
  line(`  mentions motorcycle ${asks.motorcycles} | car ${asks.cars} | asks a question ${asks.question} | names a stock no. ${asks.vehicleRef}`);

  // --- repetition: the AI asked for a fact the customer had already given
  let askedBudgetAgain = 0, askedDestAgain = 0, askedVehicleAgain = 0;
  const repeatExamples = [];
  for (const [cid, list] of byConversation) {
    const seen = [];
    for (const m of list) {
      if (m.sender === 'customer') { seen.push(String(m.body || '')); continue; }
      if (m.sender !== 'ai') continue;
      const b = String(m.body || '');
      const f = priorFacts(seen);
      if (f.budget && AI_ASK_BUDGET.test(b)) { askedBudgetAgain++; if (repeatExamples.length < 5) repeatExamples.push(`conv#${cid}: customer already gave a budget, AI asked again -> "${clip(b)}"`); }
      if (f.destination && AI_ASK_DEST.test(b)) { askedDestAgain++; if (repeatExamples.length < 8) repeatExamples.push(`conv#${cid}: destination already known, AI asked again -> "${clip(b)}"`); }
      if (f.category && AI_ASK_VEHICLE.test(b)) { askedVehicleAgain++; if (repeatExamples.length < 12) repeatExamples.push(`conv#${cid}: vehicle/category already discussed, AI asked which vehicle -> "${clip(b)}"`); }
    }
  }
  line('');
  line('REPETITION (AI asked for a fact the customer had already provided)');
  line(`  budget asked again: ${askedBudgetAgain} | destination asked again: ${askedDestAgain} | "which vehicle?" after a vehicle was discussed: ${askedVehicleAgain}`);
  for (const e of repeatExamples.slice(0, 6)) line('  e.g. ' + e);

  // --- photo promises vs delivered photos
  let promises = 0, denied = 0, delivered = 0, brokenPromises = 0;
  const photoExamples = [];
  for (const [cid, list] of byConversation) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.sender !== 'ai') continue;
      const b = String(m.body || '');
      if (AI_DENY_PHOTOS.test(b)) { denied++; continue; }
      // An offer ("I can also send you: exact photos") is not a promise that anything was sent.
      if (AI_PHOTO_OFFER.test(b) && !/\bsending\b|\bhere are\b|\bi'?ll send\b|\bsent\b/i.test(b)) continue;
      if (!AI_PROMISE_PHOTOS.test(b)) continue;
      promises++;
      /*
        Look at the whole AI turn: from this AI message until the customer speaks again. A photo is
        "delivered" when any image message lands in that window (the sender also writes a marker text
        line, so a fixed 3-message look-ahead is not reliable).
      */
      const turn = [];
      for (let k = i + 1; k < list.length; k++) { if (list[k].sender === 'customer') break; turn.push(list[k]); }
      const imageNext = turn.some((x) => x.message_type === 'image' || x.media_url)
        // the marker line the sender writes ("[Sent exact photos of ...]") proves the send flow ran
        || /\bSent exact photos\b|\bphotos sent\b/i.test(b);
      if (imageNext) delivered++;
      else { brokenPromises++; if (photoExamples.length < 5) photoExamples.push(`conv#${cid}: AI said "${clip(b)}" but no photo message followed`); }
    }
  }
  line('');
  line('PHOTO PROMISES vs DELIVERY');
  line(`  AI promised/sent photos: ${promises} | followed by an image message: ${delivered} | NOT followed by any image: ${brokenPromises} | AI said it had no exact photos: ${denied}`);
  const markers = messages.filter((m) => /^\[Sent exact photos of/i.test(String(m.body || ''))).length;
  const imageRows = messages.filter((m) => m.message_type === 'image').length;
  const convWithImages = [...byConversation.values()].filter((l) => l.some((m) => m.message_type === 'image')).length;
  line(`  ground truth: outbound image rows=${imageRows} in ${convWithImages} conversations | sender marker lines="[Sent exact photos…]"=${markers}`);
  for (const e of photoExamples) line('  e.g. ' + e);

  // --- holds, language, sale evidence
  let holds = 0, saleClaims = 0;
  const langMismatch = [];
  for (const [cid, list] of byConversation) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.sender === 'ai' && HOLD.test(String(m.body || ''))) holds++;
      if (SALE_DONE.test(String(m.body || ''))) saleClaims++;
      if (m.sender !== 'ai') continue;
      const prevCustomer = [...list.slice(0, i)].reverse().find((x) => x.sender === 'customer');
      if (!prevCustomer) continue;
      const a = scriptOf(prevCustomer.body), b = scriptOf(m.body);
      if (a !== 'other' && b !== 'other' && a !== b && langMismatch.length < 6) langMismatch.push(`conv#${cid}: customer=${a} AI=${b} -> customer "${clip(prevCustomer.body, 40)}" | AI "${clip(m.body, 60)}"`);
    }
  }
  line('');
  line(`AI HOLD LINES ("let me confirm") : ${holds}`);
  line(`LANGUAGE MISMATCH (AI script != customer script): ${langMismatch.length ? langMismatch.length + ' example(s)' : 'none found'}`);
  for (const e of langMismatch) line('  e.g. ' + e);
  line(`MESSAGES CLAIMING A COMPLETED SALE/PAYMENT/SHIPMENT: ${saleClaims} (conversation termination is NOT a sale; there is no sales/order table in these exports)`);

  // --- activity by day
  line('');
  line(`ACTIVITY (last ${DAYS} days, by day)`);
  const days = {};
  for (const m of messages) {
    const d = day(m.created_at); if (!d) continue;
    const bucket = (days[d] = days[d] || { customer: 0, ai: 0, human: 0 });
    if (m.sender === 'customer') bucket.customer++;
    else if (m.sender === 'ai') bucket.ai++;
    else if (m.sender === 'human') bucket.human++;
  }
  const keys = Object.keys(days).sort().slice(-DAYS);
  for (const d of keys) line(`  ${d}: ${JSON.stringify(days[d])}`);

  // --- conversations that look like a shared journey (multiple vehicle mentions)
  let multiVehicle = 0;
  for (const [, list] of byConversation) {
    const stocks = new Set();
    for (const m of list) STOCKS(m.body).forEach((s) => stocks.add(s));
    if (stocks.size > 1) multiVehicle++;
  }
  line('');
  line(`CONVERSATIONS MENTIONING MORE THAN ONE STOCK NUMBER: ${multiVehicle}`);

  /*
    HOLD BENCHMARK (brief item 4): for every AI hold ("let me confirm"), was the fact the customer
    asked about already available IN THIS CHAT at that moment? Available = the customer had already
    identified a vehicle (stock number, or a model the AI echoed) AND the question was price /
    availability / shipping for that identified vehicle. Those are the holds that were avoidable.
  */
  let holdTotal = 0, holdAvoidable = 0, holdUnknownVehicle = 0, holdNeedsTeam = 0;
  const holdExamples = [];
  for (const [cid, list] of byConversation) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.sender !== 'ai' || !HOLD.test(String(m.body || ''))) continue;
      holdTotal++;
      const before = list.slice(0, i);
      const lastCustomer = [...before].reverse().find((x) => x.sender === 'customer');
      const question = String(lastCustomer?.body || '');
      const knownVehicleInChat = before.some((x) => STOCKS(String(x.body || '')).length > 0) || before.some((x) => /stock\s*\d/i.test(String(x.body || '')));
      const aboutFact = ASK_PRICE.test(question) || ASK_AVAIL.test(question) || ASK_SHIP.test(question);
      if (!question.trim()) { holdNeedsTeam++; continue; }
      if (!knownVehicleInChat && !ASK_SHIP.test(question)) { holdUnknownVehicle++; continue; }
      if (aboutFact && knownVehicleInChat) {
        holdAvoidable++;
        if (holdExamples.length < 5) holdExamples.push(`conv#${cid}: customer asked "${clip(question, 50)}" while the unit was already in the chat -> AI held: "${clip(m.body, 60)}"`);
      } else if (ASK_SHIP.test(question) || ASK_PAY.test(question)) holdNeedsTeam++;
      else holdUnknownVehicle++;
    }
  }
  line('');
  line('HOLD BENCHMARK (was the answer already in the chat when the AI held?)');
  line(`  holds total ${holdTotal} | avoidable (unit already known, question was price/availability) ${holdAvoidable} | vehicle still unknown ${holdUnknownVehicle} | needed the team (shipping/payment/quote) ${holdNeedsTeam}`);
  for (const e of holdExamples) line('  e.g. ' + e);

  // --- unanswered customers with real timing (system-only events ignored)
  const now = Math.max(...messages.map((m) => ts(m.created_at)));
  const waiting = [];
  for (const [cid, list] of byConversation) {
    const lastCustomer = [...list].reverse().find((m) => m.sender === 'customer');
    if (!lastCustomer) continue;
    const lastReply = [...list].reverse().find((m) => ['ai', 'human'].includes(m.sender) && ts(m.created_at) > ts(lastCustomer.created_at));
    if (lastReply) continue;
    const hours = Math.round((now - ts(lastCustomer.created_at)) / 3600000);
    waiting.push({ cid, hours, question: clip(lastCustomer.body, 60) });
  }
  waiting.sort((a, b) => a.hours - b.hours);
  line('');
  line(`CUSTOMERS STILL WAITING (no AI/staff reply after their last message): ${waiting.length}`);
  for (const w of waiting.slice(0, 8)) line(`  conv#${w.cid}: waiting ~${w.hours}h | last customer message: "${w.question}"`);

  /*
    SANITIZED DOSSIERS for the conversations named in the brief. Ids, counts, clipped texts, masked
    numbers only - enough to verify the reported failures without exposing a customer.
  */
  if (DOSSIER.length) {
    line('');
    line('DOSSIERS (sanitized: ids, counts, clipped text, masked numbers)');
    for (const wanted of DOSSIER) {
      const list = byConversation.get(wanted);
      if (!list) { line(`  conv#${wanted}: not present in this snapshot`); continue; }
      const conv = byId.get(wanted) || {};
      const first = list[0], last = list[list.length - 1];
      const cust = list.filter((m) => m.sender === 'customer').length;
      const ai = list.filter((m) => m.sender === 'ai').length;
      const staff = list.filter((m) => m.sender === 'human').length;
      const imgs = list.filter((m) => m.message_type === 'image').length;
      const stocks = [...new Set(list.flatMap((m) => STOCKS(String(m.body || ''))))];
      const lastCustomer = [...list].reverse().find((m) => m.sender === 'customer');
      const repliedAfter = lastCustomer
        ? !!list.find((m) => ['ai', 'human'].includes(m.sender) && ts(m.created_at) > ts(lastCustomer.created_at))
        : false;
      const customerQuestions = list.filter((m) => m.sender === 'customer' && isQuestion(String(m.body || ''))).slice(-4).map((m) => clip(m.body, 70));
      const aiSamples = list.filter((m) => m.sender === 'ai').slice(-2).map((m) => clip(m.body, 70));
      const staffSamples = list.filter((m) => m.sender === 'human').slice(-2).map((m) => clip(m.body, 70));
      line(`  --- conv#${wanted} | channel=${conv.channel || '?'} | mode=${conv.mode || '?'} | staff-owned=${conv.takeover_by ? 'yes' : 'no'}`);
      line(`      messages: ${list.length} (customer ${cust}, AI ${ai}, staff ${staff}) | images ${imgs} | stock mentions: ${stocks.length ? stocks.join(',') : 'none'}`);
      line(`      window: ${day(first.created_at)} -> ${day(last.created_at)} | customer waiting at the end: ${repliedAfter ? 'no' : 'YES'}`);
      for (const q of customerQuestions) line(`      customer asked: "${q}"`);
      for (const a of aiSamples) line(`      AI last said: "${a}"`);
      for (const s of staffSamples) line(`      staff last said: "${s}"`);
    }
  }

  line('');
  line('LIMITATIONS');
  line('  - No vehicle/catalog, quote_requests, leads, orders or payment tables were provided, so vehicle-match accuracy, quote accuracy and conversions CANNOT be measured from these files.');
  line('  - "Conversation ended" is never counted as a sale.');
  line('  - Phone numbers, PSIDs and e-mail addresses are masked and never printed.');
}

main();
