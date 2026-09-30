import axios from 'axios';
import { rows } from './db';
import { history } from './conversations';

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
  const cols = 'id,stock_no,category,brand,model,trim_name,model_year,price_usd,status,transmission,mileage_km,engine,fuel_type,steering,color,location';
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
  return vs.map(v => ({ ...v, link: `${SITE}/vehicles/${v.id}` }));
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

const SYSTEM = (facts: any) => `You are the sales assistant for Sky Cars & Motorcycles, a company in China that sells cars and motorcycles and arranges export to the buyer's country.

RULES:
- Use ONLY the DATABASE FACTS below for anything about vehicles, prices, availability, shipping or tracking. Never invent a vehicle, price, rate, route, transit time, schedule, or tracking status.
- A vehicle with status "reserved" is NOT available to buy; say it is reserved and offer similar options.
- If a customer asks about a vehicle that is not in matching_vehicles, say we don't currently list it, suggest similar brands from available_inventory_by_brand, and offer that the team can source it.
- Shipping: only quote a price from confirmed_rates. If there are none, say the team will prepare a shipping quote, and share the destination ports we serve if listed.
- For payment, bank details, discounts, inspections, or anything else not in the facts, say a team member will confirm.
- When you mention a specific vehicle, include its stock number and link.
- Reply in the customer's language. Be short and friendly: this is WhatsApp. No markdown headers or tables.

DATABASE FACTS:
${JSON.stringify(facts)}`;

export async function salesReply(text: string, conversationId?: number) {
  if (!process.env.DEEPSEEK_API_KEY) return null; // no AI configured: stay silent, staff will reply
  let past: any[] = [];
  if (conversationId) { try { past = await history(conversationId, 12); } catch { } }
  // The just-stored inbound message is the last item; exclude it from context duplication
  if (past.length && past[past.length - 1].sender === 'customer' && past[past.length - 1].body === text) past = past.slice(0, -1);
  const priorCustomer = past.filter(m => m.sender === 'customer').slice(-3).map(m => m.body).join(' ');
  const facts = await buildFacts(text, priorCustomer);
  const messages = [
    { role: 'system', content: SYSTEM(facts) },
    ...past.map(m => ({ role: m.sender === 'customer' ? 'user' : 'assistant', content: String(m.body || '') })),
    { role: 'user', content: text },
  ];
  const r = await axios.post('https://api.deepseek.com/chat/completions',
    { model: MODEL, temperature: 0.2, max_tokens: 500, messages },
    { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 25000 });
  return r.data.choices?.[0]?.message?.content?.trim() || null;
}

export const AI_MODEL = MODEL;
