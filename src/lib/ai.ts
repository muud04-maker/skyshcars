import axios from 'axios';
import { rows } from './db';
import { history } from './conversations';
import { activeKnowledge } from './knowledge';
import { memoryForConversation, refreshCustomerMemory } from './customer-memory';
import {ensureLast50Vehicles} from './inventory-seed';
import { exactPhotoSql, sellableVehicleSql, whatsappPhotosForVehicle } from './exact-photos';
import { aiCarSql, catalogCounts, loadDisabledCars } from './ai-catalog';
import { flagForStaff } from './conversation-state';

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

// Only real, Available, non-demo vehicles are ever offered to customers.
async function findVehicles(text: string) {
  try{await ensureLast50Vehicles()}catch{}
  const aiCond = await aiCarSql('vehicles'); // AI Catalog: only cars the AI may sell
  const { terms, stock, years, category } = extractTerms(text);
  const cols = `id,stock_no,category,brand,model,trim_name,model_year,price_usd,status,transmission,mileage_km,engine,fuel_type,steering,color,location,
    (SELECT COUNT(*) FROM vehicle_media m WHERE m.vehicle_id=vehicles.id AND ${exactPhotoSql('m')}) exact_photo_count`;
  if (stock.length) {
    const r = await rows<any>(`SELECT ${cols} FROM vehicles WHERE stock_no IN (${stock.map(() => '?').join(',')}) AND ${aiCond}`, stock);
    if (r.length) return r;
  }
  if (!terms.length) return [];
  const where = terms.map(() => `(brand LIKE ? OR model LIKE ? OR trim_name LIKE ?)`).join(' OR ');
  const args: any[] = terms.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`]);
  let extra = '';
  if (category) { extra += ' AND category=?'; args.push(category); }
  if (years.length) { extra += ` AND model_year IN (${years.map(() => '?').join(',')})`; args.push(...years); }
  return rows<any>(`SELECT ${cols} FROM vehicles WHERE ${aiCond} AND (${where})${extra}
    ORDER BY price_usd LIMIT 10`, args);
}

/** Disabled (not in AI Catalog) cars the customer named by make/model. Names only. */
async function disabledCarsNamed(text: string) {
  const { terms } = extractTerms(text);
  if (!terms.length) return [];
  const off = await loadDisabledCars();
  const hit = off.filter(c => terms.some(t => t.length >= 3 && [c.brand, c.model].some(x => String(x || '').toLowerCase() === t)));
  return [...new Set(hit.map(c => [c.model_year, c.brand, c.model].filter(Boolean).join(' ')))].slice(0, 3);
}

/** Stock numbers the customer named that exist but are not for sale, so the AI can say so honestly. */
async function unavailableRequested(text: string) {
  const { stock } = extractTerms(text);
  if (!stock.length) return [];
  const r = await rows<any>(`SELECT stock_no,status FROM vehicles WHERE stock_no IN (${stock.map(() => '?').join(',')}) AND NOT (${await aiCarSql('vehicles')})`, stock);
  return r.map(x => ({ stock_no: x.stock_no, status: x.status === 'reserved' ? 'reserved' : x.status === 'sold' ? 'sold' : 'not_available' }));
}

async function inventorySummary() {
  return rows<any>(`SELECT category, brand, COUNT(*) n, MIN(price_usd) min_usd, MAX(price_usd) max_usd
    FROM vehicles WHERE ${await aiCarSql('vehicles')} AND brand<>'' GROUP BY category, brand ORDER BY n DESC LIMIT 25`);
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
  return vs.map(v => ({ ...v, exact_photo_count: Number(v.exact_photo_count || 0), link: `${SITE}/vehicles/${v.id}` }));
}

const PHOTO_WORDS = /\b(photos?|pictures?|pics?|images?|show me|let me see|see (it|the car|the bike))\b/i;
export function wantsPhotos(text: string) { return PHOTO_WORDS.test(text); }

/**
 * Finds the vehicle the customer wants photos of and its EXACT approved photos (max 3).
 * Never returns model/representative/demo images. Falls back to the last 3 customer messages
 * for follow-ups like "send photos".
 */
export async function vehicleMediaForMessage(text: string, conversationId?: number) {
  let priorCustomer = '';
  if (conversationId) {
    try {
      const past = await history(conversationId, 10);
      priorCustomer = past.filter(m => m.sender === 'customer').slice(-4, -1).map(m => String(m.body || '')).join(' ');
    } catch {}
  }
  let vehicles = await findVehicles(text);
  if (!vehicles.length && priorCustomer) vehicles = await findVehicles(priorCustomer);
  const v = vehicles[0];
  if (!v) return null;
  // JPEG/PNG only, supplier photos via our own proxy URL (see exact-photos.ts).
  const images = (await whatsappPhotosForVehicle(Number(v.id), 3)).map(p => p.url);
  const title = `${v.model_year || ''} ${v.brand || ''} ${v.model || ''}`.replace(/\s+/g,' ').trim();
  return {
    vehicleId: Number(v.id), stockNo: String(v.stock_no || ''), title, images, exact: images.length > 0,
    caption: `${title}${v.stock_no ? ` • ${v.stock_no}` : ''}${v.price_usd ? ` • $${Number(v.price_usd).toLocaleString()}` : ''}\nExact photos of this unit\n${SITE}/vehicles/${v.id}`
  };
}

/** What the system will do about a photo request; given to the AI so its text matches reality. */
export type PhotoPlan = {
  status: 'sending' | 'no_exact_photos' | 'already_sent' | 'no_vehicle';
  vehicleId?: number; stockNo?: string; title?: string; images: string[]; caption?: string;
};

export async function buildFacts(text: string, priorCustomerText = '') {
  const safe = async <T>(f: () => Promise<T>, d: T) => { try { return await f(); } catch (e) { console.error('AI_FACTS', e); return d; } };
  let vehicles = await safe(() => findVehicles(text), []);
  // Follow-up questions ("how much is it?") fall back to what they asked about earlier
  if (!vehicles.length && priorCustomerText) vehicles = await safe(() => findVehicles(priorCustomerText), []);
  const shipping = await safe(() => findShipping(text + ' ' + priorCustomerText), null);
  const tracking = await safe(() => findTracking(text), null);
  const summary = vehicles.length ? null : await safe(() => inventorySummary(), []);
  const unavailable: any[] = await safe(() => unavailableRequested(text), []);
  // Cars that exist but are not in the AI Catalog: say "not available right now" (no price, no photos).
  if (!vehicles.length) { const named = await safe(() => disabledCarsNamed(text), [] as any[]); for (const n of named) unavailable.push({ name: n, status: 'not_available' }); }
  return {
    matching_vehicles: withLinks(vehicles),
    requested_but_not_available: unavailable.length ? unavailable : undefined,
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

const SYSTEM = (facts: any, customer: any, knowledge: any[], memory: any, humanExamples: string[]) => `You are Sky Cars & Motorcycles' WhatsApp sales assistant. Your job is to move real customers toward a sale while sounding like a helpful human salesperson, not a website menu.

IDENTITY AND TONE:
- Speak as "Sky Cars" or "our team". Do not volunteer that replies are automated. If directly asked, answer truthfully and briefly.
- Be warm, natural, concise, practical, and conversational. Usually 1-4 short WhatsApp paragraphs.
- Never sound like a catalogue dump, FAQ bot, or repeated advertisement.
- Read the full conversation before every reply and continue the exact topic. Do not restart the conversation.
- If the customer explicitly chooses a language (for example "English only"), keep using that language until they change it. Explicit language preference overrides language inferred from earlier messages.
- Do not repeat information, links, stock details, or the same sales question unless the customer asks again or it is necessary to clarify.
- If the latest message is only "yes", "ok", "sure", an emoji, or another short acknowledgement, answer the immediately previous question. Do not randomly revive an older vehicle or topic. If the reference is unclear, ask one short clarifying question.

HUMAN SALES BEHAVIOR:
- First answer what the customer just asked. Then, when useful, ask ONE natural next-step question that helps the sale (budget, preferred model, destination, body type, etc.).
- Recommend at most 2-4 relevant vehicles at a time. Do not overwhelm the customer with a long list unless they ask for one.
- Do not send generic "browse our website" messages as the default response.
- Do not push a quote form immediately. Collect the key information in chat first and only mention a quote/handoff when the customer is actually ready for shipping/price confirmation.
- LINKS ARE OPTIONAL, NOT DEFAULT. Send a vehicle/site link only when the customer asks to see the listing, photos, more details, wants to open it, or is clearly ready to act. Maximum one useful link in a normal reply. Never repeat the same link in consecutive replies.
- If a customer asks what cars are available, summarize a few relevant choices and ask budget/type. Do not answer mainly with a link.
- PHOTOS: follow DATABASE FACTS.photo_request exactly. Never paste image URLs.
  * status "sending": say briefly that you are sending the photos of that vehicle now (the system sends them right after your text).
  * status "no_exact_photos": say honestly that we do not have exact photos of this specific unit yet and that the team can request real photos from the yard. Never offer model, catalogue, stock or "similar" images as if they were this unit.
  * status "already_sent": say the photos were sent just above in this chat; do not promise to send them again.
  * status "no_vehicle": ask which vehicle (model or stock number) they want photos of.
  * If photo_request is absent, do not promise or mention sending photos.
- Never send a new message without a new customer message or an explicit admin action. The application enforces this too; do not create follow-up messages on your own.

SALES RULES:
- Use ONLY DATABASE FACTS for vehicles, prices, availability, shipping or tracking. Never invent a vehicle, price, rate, route, transit time, schedule, inspection, discount, condition, or tracking event.
- Only vehicles in matching_vehicles / available_inventory_by_brand are for sale. Never offer anything else.
- If requested_but_not_available lists a stock number, say plainly that it is reserved, sold or no longer available, and offer available alternatives.
- If the exact requested vehicle is not listed, say it is not currently listed and offer sourcing. Ask only for missing details.
- Shipping prices may only come from confirmed_rates. If no confirmed rate exists, explain briefly that the team must confirm it; continue helping in chat instead of immediately sending the customer away to a form.
- For payment details, bank details, discounts, inspections, finance, guarantees, or anything not in verified facts/knowledge, say the team will confirm.
- Mention stock number when it helps identify a specific vehicle. A website link is not required unless the link rules above say it is useful.
- Never claim a photo is the exact vehicle unless the verified listing has that photo.
- No markdown tables. Avoid excessive bolding, headings, repeated emojis, and canned closings.

CUSTOMER CONTEXT (internal; never expose as internal notes):
${JSON.stringify(customer || {})}

PERSISTENT CUSTOMER MEMORY (internal; use for continuity, never expose as internal notes).
"said_in_whatsapp_groups" is what THIS person wrote in Sky Cars WhatsApp groups. You may refer to it naturally (for example "you asked in the group about the Hilux"). Never mention other group members, suppliers or supplier prices.
${JSON.stringify(memory || {})}

RECENT HUMAN STAFF REPLY EXAMPLES (learn tone and decisions; do not copy blindly):
${JSON.stringify(humanExamples || [])}

SKY CARS BUSINESS KNOWLEDGE TAUGHT BY ADMIN:
${JSON.stringify(knowledge || [])}

DATABASE FACTS:
${JSON.stringify(facts)}`;

function compactVehicleLine(v:any, includeLink=false){
  const title=[v.model_year,v.brand,v.model,v.trim_name].filter(Boolean).join(' ');
  const price=v.price_usd!=null?`$${Number(v.price_usd).toLocaleString()}`:'Price on request';
  return `${title || 'Vehicle'} — ${price}${v.stock_no?` (${v.stock_no})`:''}${includeLink&&v.link?`\n${v.link}`:''}`;
}

function wantsLink(text:string){
  return /\b(link|website|listing|open|page|details online|send.*link|where can i see|show.*listing)\b/i.test(text);
}

function photoLine(plan?:PhotoPlan|null){
  if(!plan)return '';
  const name=plan.title?`the ${plan.title}${plan.stockNo?` (${plan.stockNo})`:''}`:'that vehicle';
  if(plan.status==='sending')return `Sending you the photos of ${name} now.`;
  if(plan.status==='already_sent')return `I sent the photos of ${name} just above.`;
  if(plan.status==='no_exact_photos')return `We don't have exact photos of ${name} yet. Our team can request real photos of this unit for you.`;
  return 'Which vehicle would you like photos of? Send me the model or stock number.';
}

function deterministicFallback(text:string,facts:any,past:any[],plan?:PhotoPlan|null){
  const p=photoLine(plan);
  const base=deterministicText(text,facts,past);
  return p?`${p}\n\n${base}`:base;
}

function deterministicText(text:string,facts:any,past:any[]){
  const vehicles=Array.isArray(facts?.matching_vehicles)?facts.matching_vehicles:[];
  const gone=Array.isArray(facts?.requested_but_not_available)?facts.requested_but_not_available:[];
  if(gone.length&&!vehicles.length)return `${gone.map((g:any)=>g.stock_no||g.name).join(', ')} is ${gone[0].status==='sold'?'already sold':gone[0].status==='reserved'?'reserved':'no longer available'}. Tell me the type of vehicle and budget you have in mind, and I'll check what we have available now.`;
  const lower=text.toLowerCase();
  const includeLink=wantsLink(text);
  if(/(chat between us|our chat|previous chat|earlier messages|remember|what did i say|history)/i.test(text)){
    const recent=past.filter(m=>m.sender==='customer').slice(-5).map(m=>String(m.body||'').replace(/\s+/g,' ').slice(0,140));
    if(recent.length) return `Yes, I can see our recent conversation. You mentioned ${recent.slice(-3).map(x=>`“${x}”`).join(', ')}. Which part would you like to continue with?`;
  }
  if(vehicles.length){
    const max=/\bunder\s*\$?([0-9][0-9,]*)|\$\s*([0-9][0-9,]*)\s*(?:budget|max|maximum)?/i.exec(text);
    let chosen=vehicles;
    if(max){const n=Number((max[1]||max[2]||'').replace(/,/g,'')); if(n) chosen=chosen.filter((v:any)=>Number(v.price_usd||Infinity)<=n);}
    chosen=(chosen.length?chosen:vehicles).slice(0,3);
    return `Yes. A few verified options we have now are:

${chosen.map((v:any)=>compactVehicleLine(v,includeLink)).join('\n')}

What budget and type of car are you looking for?`;
  }
  const summary=Array.isArray(facts?.available_inventory_by_brand)?facts.available_inventory_by_brand:[];
  if(/\b(what cars|what.*have|available|inventory|stock|cars.*now|vehicles.*now|do you have car)\b/i.test(lower) && summary.length){
    const brands=summary.filter((x:any)=>x.category==='car').slice(0,7).map((x:any)=>x.brand);
    return `Yes, we have cars available now, including ${brands.join(', ')} and more. What is your budget, and do you prefer a sedan or SUV?`;
  }
  return `Yes, I can help. Tell me what car you are looking for and your budget, and I’ll check our current stock.`;
}

export async function salesReply(text: string, conversationId?: number, photoPlan?: PhotoPlan | null, opts: { note?: string } = {}) {
  // AI Catalog empty: never improvise stock. Honest short message, chat flagged for staff (AI stays on).
  try {
    const { aiCount } = await catalogCounts();
    if (!aiCount) {
      if (conversationId) await flagForStaff(conversationId, 'AI Catalog has no cars enabled').catch(() => {});
      return 'Thanks for your message. Our team will reply shortly with the cars we have available right now.';
    }
  } catch {}
  let past: any[] = [];
  if (conversationId) { try { past = await history(conversationId, 250); } catch { } }
  // The just-stored inbound message is the last item; exclude it from context duplication.
  if (past.length && past[past.length - 1].sender === 'customer' && past[past.length - 1].body === text) past = past.slice(0, -1);
  const priorCustomer = past.filter(m => m.sender === 'customer').slice(-80).map(m => m.body).join(' ');
  let memory:any = null;
  if (conversationId) { try { memory = await memoryForConversation(conversationId); } catch {} }
  const humanExamples = past.filter(m => m.sender === 'human').slice(-30).map(m => String(m.body||'')).filter(Boolean);
  const [facts, customer, knowledge] = await Promise.all([
    buildFacts(text, priorCustomer + ' ' + String(memory?.summary||'')), customerContext(conversationId), knowledgeContext()
  ]);
  if (photoPlan) (facts as any).photo_request = { status: photoPlan.status, vehicle: photoPlan.title || null, stock_no: photoPlan.stockNo || null, photo_count: photoPlan.images.length };

  // Explicit history questions are answered from the real stored transcript, not guessed by the model.
  if (/(chat between us|our chat|previous chat|earlier messages|remember|what did i say|history)/i.test(text) && past.some(m=>m.sender==='customer')) {
    return deterministicFallback(text,facts,past,photoPlan);
  }

  if (!process.env.DEEPSEEK_API_KEY) return deterministicFallback(text,facts,past,photoPlan);
  const transcript = past.slice(-120).map(m=>`${String(m.sender||'').toUpperCase()}: ${String(m.body||'')}`).join('\n');
  const messages = [
    { role: 'system', content: SYSTEM(facts, customer, knowledge, memory, humanExamples) + (opts.note ? `

SYSTEM NOTE: ${opts.note}` : '') + `\n\nREAL STORED CONVERSATION TRANSCRIPT (oldest to newest):\n${transcript || '[No earlier stored messages]'}` },
    ...past.slice(-120).map(m => ({ role: m.sender === 'customer' ? 'user' : 'assistant', content: String(m.body || '') })),
    { role: 'user', content: text },
  ];
  try{
    const r = await axios.post('https://api.deepseek.com/chat/completions',
      { model: MODEL, temperature: 0.2, max_tokens: 650, messages },
      { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 25000 });
    const answer = r.data.choices?.[0]?.message?.content?.trim() || null;
    if (conversationId) { try { await refreshCustomerMemory(conversationId); } catch {} }
    return answer || deterministicFallback(text,facts,past,photoPlan);
  }catch(e){
    console.error('DEEPSEEK_REPLY_FAILED_USING_FALLBACK',e);
    return deterministicFallback(text,facts,past,photoPlan);
  }
}

export const AI_MODEL = MODEL;
