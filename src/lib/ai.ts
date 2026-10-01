import axios from 'axios';
import { rows } from './db';
import { history } from './conversations';
import { activeKnowledge } from './knowledge';
import { memoryForConversation, refreshCustomerMemory } from './customer-memory';

/*
  Grounded sales assistant. Every fact the AI may state (vehicles, prices,
  shipping, tracking) is looked up in the database first and passed in.
  The AI is told to never state anything that is not in those facts.
*/

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const STOP = new Set(('a an the and or but is are was were be do does did have has had you your we our i me my it its this that these those ' +
  'what which who how much many price prices cost costs usd dollar dollars car cars vehicle vehicles motorcycle motorcycles bike bikes moto ' +
  'please pls want need looking for any some there available stock sell selling buy send ship shipping to from in on at of with can could ' +
  'would will hi hello salam thanks thank ok okay yes no not year model get give me about more info details photo photos picture pictures').split(' '));

export function extractTerms(text: string) {
  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ');
  const words = clean.split(/\s+/).filter(Boolean);
  const stock = [...text.matchAll(/\bSC\s?-?(\d{1,6})\b/gi)].map(m => 'SC' + m[1].padStart(5, '0'));
  const terms = words.filter(w => w.length >= 2 && !STOP.has(w) && !/^\d{1,3}$/.test(w)).slice(0, 8);
  const years = words.filter(w => /^(19[89]\d|20[0-3]\d)$/.test(w)).map(Number);
  const category = /\b(motorcycles?|motorbikes?|bikes?|moto)\b/i.test(text) ? 'motorcycle'
    : /\b(cars?|suv|sedan)\b/i.test(text) ? 'car' : null;
  return { terms: terms.filter(t => !/^(19[89]\d|20[0-3]\d)$/.test(t)), stock, years, category };
}

async function findVehicles(text: string) {
  const { terms, stock, years, category } = extractTerms(text);
  const cols = `id,stock_no,category,brand,model,trim_name,model_year,price_usd,status,transmission,mileage_km,engine,fuel_type,steering,color,location,
    (SELECT url FROM vehicle_media m WHERE m.vehicle_id=vehicles.id AND m.media_type='image' AND m.review_status='approved' ORDER BY m.is_cover DESC,m.sort_order,id LIMIT 1) cover_url`;
  if (stock.length) {
    const r = await rows<any>(`SELECT ${cols} FROM vehicles WHERE stock_no IN (${stock.map(() => '?').join(',')}) AND status IN ('available','reserved','sold')`, stock);
    if (r.length) return r;
  }
  if (!terms.length) return [];
  const where = terms.map(() => `(brand LIKE ? OR model LIKE ? OR trim_name LIKE ?)`).join(' OR ');
  const args: any[] = terms.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`]);
  let extra = '';
  if (category) { extra += ' AND category=?'; args.push(category); }
  if (years.length) { extra += ` AND model_year IN (${years.map(() => '?').join(',')})`; args.push(...years); }
  return rows<any>(`SELECT ${cols} FROM vehicles WHERE status IN ('available','reserved') AND (${where})${extra}
    ORDER BY status='available' DESC, price_usd LIMIT 10`, args);
}

async function inventorySummary() {
  return rows<any>(`SELECT category, brand, COUNT(*) n, MIN(price_usd) min_usd, MAX(price_usd) max_usd
    FROM vehicles WHERE status='available' AND brand<>'' GROUP BY category, brand ORDER BY n DESC LIMIT 25`);
}

async function findShipping(text: string) {
  const lower = ' ' + text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ') + ' ';
  const countries = await rows<any>('SELECT id,name,preferred_steering,landlocked,notes FROM countries WHERE active=1');
  const ports = await rows<any>(`SELECT p.id,p.name,p.country_id,c.name country FROM ports p JOIN countries c ON c.id=p.country_id WHERE p.active=1`);
  const hitC = countries.filter(c => lower.includes(' ' + c.name.toLowerCase() + ' '));
  const hitP = ports.filter(p => lower.includes(' ' + p.name.toLowerCase() + ' '));
  const ids = new Set([...hitC.map(c => c.id), ...hitP.map(p => p.country_id)]);
  if (!ids.size) return null;
  const idList = [...ids].slice(0, 3);
  const out = [];
  for (const id of idList) {
    const c = countries.find(x => x.id === id);
    const rates = await rows<any>(`SELECT r.method, r.origin_port, p.name destination_port, r.transit_days_min, r.transit_days_max,
        s.vehicle_category, s.amount_usd, s.valid_until
      FROM shipping_routes r JOIN ports p ON p.id=r.destination_port_id
      JOIN shipping_rates s ON s.route_id=r.id
      WHERE p.country_id=? AND r.status='confirmed' AND s.confirmed=1
        AND (s.valid_until IS NULL OR s.valid_until>=CURDATE())`, [id]);
    out.push({
      country: c.name, preferred_steering: c.preferred_steering, landlocked: !!c.landlocked,
      ports: ports.filter(p => p.country_id === id).map(p => p.name),
      confirmed_rates: rates, note: rates.length ? undefined : 'No confirmed shipping rate on file: price must be quoted by the sales team.',
    });
  }
  return out;
}

async function findTracking(text: string) {
  const refs = [...new Set((text.match(/\b[A-Z0-9][A-Z0-9-]{5,}\b/gi) || []).map(s => s.toUpperCase()))].slice(0, 3);
  if (!refs.length) return null;
  const s = await rows<any>(`SELECT s.id, s.tracking_reference, s.current_status, s.vessel_name, s.eta, s.public_note
    FROM shipments s WHERE s.tracking_reference IN (${refs.map(() => '?').join(',')})`, refs);
  for (const x of s) {
    x.events = await rows<any>(`SELECT status,title,public_description,event_time FROM tracking_events
      WHERE shipment_id=? ORDER BY event_time DESC LIMIT 5`, [x.id]);
    delete x.id;
  }
  return s.length ? s : null;
}

function withLinks(vs: any[]) {
  return vs.map(v => ({ ...v, link: `${SITE}/vehicles/${v.id}`, image: v.cover_url ? (String(v.cover_url).startsWith('http') ? v.cover_url : SITE + v.cover_url) : null }));
}

export async function vehicleMediaForMessage(text: string, conversationId?: number) {
  let priorCustomer = '';
  if (conversationId) {
    try {
      const past = await history(conversationId, 10);
      priorCustomer = past.filter(m => m.sender === 'customer').slice(-3).map(m => String(m.body || '')).join(' ');
    } catch {}
  }
  let vehicles = await findVehicles(text);
  if (!vehicles.length && priorCustomer) vehicles = await findVehicles(priorCustomer);
  const v = vehicles.find((x:any) => x.status === 'available') || vehicles[0];
  if (!v) return null;
  const mediaRows = await rows<any>(`SELECT url FROM vehicle_media WHERE vehicle_id=? AND media_type='image' AND review_status='approved' ORDER BY is_cover DESC,sort_order,id LIMIT 3`,[v.id]);
  const images = mediaRows.map((m:any)=>String(m.url||'')).filter(Boolean).map((u:string)=>u.startsWith('http')?u:SITE+u);
  if (!images.length) return null; // only send approved real website photos to customers
  const title = `${v.model_year || ''} ${v.brand || ''} ${v.model || ''}`.trim();
  return {
    vehicleId: v.id, stockNo: v.stock_no, title, image: images[0], images,
    caption: `${title}${v.stock_no ? ` • ${v.stock_no}` : ''}${v.price_usd ? ` • $${Number(v.price_usd).toLocaleString()}` : ''}\n${SITE}/vehicles/${v.id}`
  };
}


export async function buildFacts(text: string, priorCustomerText = '') {
  const safe = async <T>(f: () => Promise<T>, d: T) => { try { return await f(); } catch (e) { console.error('AI_FACTS', e); return d; } };
  let vehicles = await safe(() => findVehicles(text), []);
  // Follow-up questions ("how much is it?") fall back to what they asked about earlier
  if (!vehicles.length && priorCustomerText) vehicles = await safe(() => findVehicles(priorCustomerText), []);
  const shipping = await safe(() => findShipping(text + ' ' + priorCustomerText), null);
  const tracking = await safe(() => findTracking(text), null);
  const summary = vehicles.length ? null : await safe(() => inventorySummary(), []);
  return {
    matching_vehicles: withLinks(vehicles),
    available_inventory_by_brand: summary,
    shipping,
    tracking,
    website: SITE,
    browse_links: { all: `${SITE}/vehicles`, cars: `${SITE}/cars`, motorcycles: `${SITE}/motorcycles`, quote: `${SITE}/quote`, tracking: `${SITE}/tracking` },
  };
}


async function customerContext(conversationId?: number) {
  if (!conversationId) return null;
  try {
    const r = await rows<any>(`SELECT cu.full_name,cu.phone,cu.email,cu.country,cu.preferred_language,cu.notes
      FROM conversations c LEFT JOIN customers cu ON cu.id=c.customer_id WHERE c.id=? LIMIT 1`, [conversationId]);
    return r[0] || null;
  } catch { return null; }
}

async function knowledgeContext() {
  try {
    const items = await activeKnowledge(40);
    return items.map((x:any)=>({title:x.title,content:x.content}));
  } catch { return []; }
}

const SYSTEM = (facts: any, customer: any, knowledge: any[], memory: any, humanExamples: string[]) => `You are Sky Cars & Motorcycles' sales assistant. You help customers buy cars and motorcycles from China and arrange export support.

IDENTITY AND TONE:
- Speak as "Sky Cars" or "our team". Do not volunteer that replies are automated or generated by AI.
- Never falsely claim to be a specific human employee. If a customer directly asks whether you are AI/automated, answer truthfully and briefly: "I'm Sky Cars' automated sales assistant, and I can connect you with our team anytime."
- Sound like a capable real sales desk: warm, concise, confident, practical, and natural. Avoid repetitive canned wording.
- Reply in the customer's language whenever you can infer it from the conversation.
- Read the conversation history before answering. Continue the same topic instead of starting over.
- Use known customer context (name, country, language, prior requests, admin notes) when relevant, but do not expose internal notes.
- If the customer says "it", "that one", "send it", "how much", etc., resolve it from recent conversation history.
- Ask only one short clarifying question when essential. Do not ask again for facts already provided.

SALES RULES:
- Use ONLY DATABASE FACTS for vehicles, prices, availability, shipping or tracking. Never invent a vehicle, price, rate, route, transit time, schedule, inspection, discount, condition, or tracking event.
- A reserved vehicle is not available. Say it is reserved and offer available alternatives.
- If the exact requested vehicle is not listed, say it is not currently listed and offer sourcing. Ask for model/year/budget/destination only if those details are still missing.
- Shipping prices may only come from confirmed_rates. Otherwise say the sales team will prepare a quote.
- For payment details, bank details, discounts, inspections, finance, guarantees, or anything not in the verified facts/knowledge, say the team will confirm.
- When mentioning a specific vehicle, include its stock number and website link when useful.
- If a verified real vehicle photo is available, the system may send it separately. Never claim a photo is the exact vehicle unless the verified website listing has that photo.
- Keep WhatsApp replies short unless the customer clearly needs more detail. No markdown tables or formal report style.

CUSTOMER CONTEXT (internal; never quote as internal notes):
${JSON.stringify(customer || {})}

PERSISTENT CUSTOMER MEMORY (internal; use for continuity, never expose as internal notes):
${JSON.stringify(memory || {})}

RECENT HUMAN STAFF REPLY EXAMPLES (learn tone and decisions; do not copy blindly):
${JSON.stringify(humanExamples || [])}

SKY CARS BUSINESS KNOWLEDGE TAUGHT BY ADMIN:
${JSON.stringify(knowledge || [])}

DATABASE FACTS:
${JSON.stringify(facts)}`;

export async function salesReply(text: string, conversationId?: number) {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  let past: any[] = [];
  if (conversationId) { try { past = await history(conversationId, 80); } catch { } }
  // The just-stored inbound message is the last item; exclude it from context duplication.
  if (past.length && past[past.length - 1].sender === 'customer' && past[past.length - 1].body === text) past = past.slice(0, -1);
  const priorCustomer = past.filter(m => m.sender === 'customer').slice(-20).map(m => m.body).join(' ');
  let memory:any = null;
  if (conversationId) { try { memory = await memoryForConversation(conversationId); } catch {} }
  const humanExamples = past.filter(m => m.sender === 'human').slice(-12).map(m => String(m.body||'')).filter(Boolean);
  const [facts, customer, knowledge] = await Promise.all([
    buildFacts(text, priorCustomer + ' ' + String(memory?.summary||'')), customerContext(conversationId), knowledgeContext()
  ]);
  const messages = [
    { role: 'system', content: SYSTEM(facts, customer, knowledge, memory, humanExamples) },
    ...past.map(m => ({ role: m.sender === 'customer' ? 'user' : 'assistant', content: String(m.body || '') })),
    { role: 'user', content: text },
  ];
  const r = await axios.post('https://api.deepseek.com/chat/completions',
    { model: MODEL, temperature: 0.35, max_tokens: 650, messages },
    { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 25000 });
  const answer = r.data.choices?.[0]?.message?.content?.trim() || null;
  if (conversationId) { try { await refreshCustomerMemory(conversationId); } catch {} }
  return answer;
}

export const AI_MODEL = MODEL;
