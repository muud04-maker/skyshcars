/*
  Real sales-agent answers (pure + testable).

  "Can I get more info on this?" / "price?" / "what else?" must be answered from the vehicle the
  conversation is about - never with "Let me confirm that for you." The count, the fields and the
  alternatives all come from the rows the caller passes in (AI Catalog: Available + ai_enabled), so
  nothing can be invented and blank fields are never shown.
*/

export type AnyCar = {
  id?: any; stock_no?: any; brand?: any; model?: any; trim_name?: any; model_year?: any;
  price_usd?: any; mileage_km?: any; engine?: any; transmission?: any; fuel_type?: any;
  steering?: any; color?: any; location?: any; category?: any; exact_photo_count?: any; created_at?: any;
};

export type VehicleIntent = 'details' | 'price' | 'photos' | 'alternatives' | 'shipping' | 'moreinfo' | null;

const PHOTOS = /\b(photos?|pictures?|pics?|images?|show me|send (me )?(the )?(photos?|pictures?)|sawir\w*|\u0635\u0648\u0631|\u7167\u7247)\b/i;
const PRICE = /\b(price|cost|how much|qiimo\w*|meeqa|imisa|\u0633\u0639\u0631|\u4ef7\u683c|\u591a\u5c11\u94b1)\b/i;
const ALT = /\b(what else|anything else|similar|alternatives?|other options?|more options|cheaper|options|others|kale|beddel|\u0623\u062e\u0631\u0649|\u5176\u4ed6)\b/i;
const SHIP = /\b(ship|shipping|deliver|delivery|freight|port|destination)\b/i;
const DETAILS = /\b(more info|info|information|details?|tell me about|specs?|specifications?|describe|about this|mileage|year|engine|fuel|transmission|color|colour|condition|availability|available|stock|location|macluumaad|faahfaahin|\u062a\u0641\u0627\u0635\u064a\u0644|\u8be6\u60c5)\b/i;

/** What is the customer asking about the vehicle? (null = not a vehicle question) */
export function vehicleIntent(text: string): VehicleIntent {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (PHOTOS.test(t)) return 'photos';
  if (ALT.test(t)) return 'alternatives';
  if (PRICE.test(t)) return 'price';
  if (SHIP.test(t)) return 'shipping';
  if (/more info|info on this|about this|details?/i.test(t)) return 'moreinfo';
  if (DETAILS.test(t)) return 'details';
  return null;
}

export function carTitle(c?: AnyCar | null) {
  if (!c) return 'Vehicle';
  return [c.model_year, c.brand, c.model, c.trim_name].filter(Boolean).join(' ') || String(c.stock_no || 'Vehicle');
}
const money = (v: any) => (Number(v) > 0 ? '$' + Number(v).toLocaleString('en-US') : '');
const km = (v: any) => (Number(v) > 0 ? `${Number(v).toLocaleString('en-US')} km` : '');

type Labels = { details: string; price: string; mileage: string; engine: string; fuel: string; transmission: string; color: string; status: string; stock: string; steering: string; location: string; canHelp: string; photos: string; shipping: string; similar: string; cheaper: string; alternatives: string; askVehicle: string; askDestination: string };
const EN: Labels = { details: 'Details', price: 'Price', mileage: 'Mileage', engine: 'Engine', fuel: 'Fuel', transmission: 'Transmission', color: 'Color', status: 'Status', stock: 'Stock', steering: 'Steering', location: 'Location', canHelp: 'I can also send you', photos: 'exact photos', shipping: 'shipping cost to your country/port', similar: 'similar vehicles', cheaper: 'cheaper options', alternatives: 'You may also like', askVehicle: 'Which vehicle do you mean? Send me the model or the stock number and I will check it for you.', askDestination: 'Which country or port should I calculate shipping to?' };
const SO: Labels = { details: 'Faahfaahin', price: 'Qiimo', mileage: 'Masaafo', engine: 'Mishiin', fuel: 'Shidaal', transmission: 'Gear', color: 'Midab', status: 'Xaalad', stock: 'Stock', steering: 'Iskuul', location: 'Goob', canHelp: 'Waxaan sidoo kale kuu soo diri karaa', photos: 'sawirrada saxda ah', shipping: 'qiimaha rarista dal/port-kaaga', similar: 'baabuur la mid ah', cheaper: 'xulashooyin jaban', alternatives: 'Waxa kale oo jira', askVehicle: 'Baabuurkee ayaad ka hadlaysaa? Ii soo dir nooca ama lambarka stock-ka waan kuu soo eegi doonaa.', askDestination: 'Dalkee ama dekeddee ayaan qiimaha rarista u xisaabinayaa?' };
const AR: Labels = { details: '\u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644', price: '\u0627\u0644\u0633\u0639\u0631', mileage: '\u0627\u0644\u0645\u0633\u0627\u0641\u0629', engine: '\u0627\u0644\u0645\u062d\u0631\u0643', fuel: '\u0627\u0644\u0648\u0642\u0648\u062f', transmission: '\u0646\u0627\u0642\u0644 \u0627\u0644\u062d\u0631\u0643\u0629', color: '\u0627\u0644\u0644\u0648\u0646', status: '\u0627\u0644\u062d\u0627\u0644\u0629', stock: '\u0631\u0642\u0645 \u0627\u0644\u0645\u062e\u0632\u0648\u0646', steering: '\u0627\u0644\u0645\u0642\u0648\u062f', location: '\u0627\u0644\u0645\u0648\u0642\u0639', canHelp: '\u064a\u0645\u0643\u0646\u0646\u064a \u0623\u064a\u0636\u0627\u064b \u0625\u0631\u0633\u0627\u0644', photos: '\u0627\u0644\u0635\u0648\u0631 \u0627\u0644\u062d\u0642\u064a\u0642\u064a\u0629', shipping: '\u062a\u0643\u0644\u0641\u0629 \u0627\u0644\u0634\u062d\u0646 \u0625\u0644\u0649 \u0628\u0644\u062f\u0643', similar: '\u0633\u064a\u0627\u0631\u0627\u062a \u0645\u0634\u0627\u0628\u0647\u0629', cheaper: '\u062e\u064a\u0627\u0631\u0627\u062a \u0623\u0631\u062e\u0635', alternatives: '\u0642\u062f \u064a\u0639\u062c\u0628\u0643 \u0623\u064a\u0636\u0627\u064b', askVehicle: '\u0623\u064a \u0633\u064a\u0627\u0631\u0629 \u062a\u0642\u0635\u062f\u061f \u0623\u0631\u0633\u0644 \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0623\u0648 \u0631\u0642\u0645 \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0648\u0633\u0623\u062a\u062d\u0642\u0642 \u0644\u0643.', askDestination: '\u0625\u0644\u0649 \u0623\u064a \u0628\u0644\u062f \u0623\u062d\u0633\u0628 \u062a\u0643\u0644\u0641\u0629 \u0627\u0644\u0634\u062d\u0646\u061f' };
const ZH: Labels = { details: '\u8be6\u60c5', price: '\u4ef7\u683c', mileage: '\u91cc\u7a0b', engine: '\u53d1\u52a8\u673a', fuel: '\u71c3\u6cb9', transmission: '\u53d8\u901f\u7bb1', color: '\u989c\u8272', status: '\u72b6\u6001', stock: '\u8f66\u6e90\u7f16\u53f7', steering: '\u65b9\u5411', location: '\u5730\u70b9', canHelp: '\u6211\u8fd8\u53ef\u4ee5\u53d1\u9001', photos: '\u539f\u8f66\u7167\u7247', shipping: '\u5230\u60a8\u56fd\u5bb6\u7684\u8fd0\u8d39', similar: '\u7c7b\u4f3c\u8f66\u578b', cheaper: '\u66f4\u4fbf\u5b9c\u7684\u9009\u62e9', alternatives: '\u60a8\u4e5f\u53ef\u80fd\u559c\u6b22', askVehicle: '\u60a8\u6307\u7684\u662f\u54ea\u4e00\u8f86\uff1f\u53d1\u9001\u578b\u53f7\u6216\u8f66\u6e90\u7f16\u53f7\uff0c\u6211\u6765\u67e5\u8be2\u3002', askDestination: '\u8fd0\u5230\u54ea\u4e2a\u56fd\u5bb6\u6216\u6e2f\u53e3\uff1f\u6211\u6765\u7b97\u8fd0\u8d39\u3002' };
const L = (lang?: string): Labels => (lang === 'so' ? SO : lang === 'ar' ? AR : lang === 'zh' ? ZH : EN);

/** Real, non-empty fields only - never a blank label, never an invented value. */
export function vehicleDetails(car: AnyCar, lang = 'en', opts: { maxLines?: number } = {}) {
  const l = L(lang);
  const head = lang === 'so' ? `Haa - kani waa ${carTitle(car)}` : lang === 'ar' ? `\u0646\u0639\u0645 - \u0647\u0630\u0647 ${carTitle(car)}` : lang === 'zh' ? `\u662f\u7684\uff0c\u8fd9\u662f ${carTitle(car)}` : `Yes - this is the ${carTitle(car)}`;
  const rows: string[] = [];
  const push = (label: string, v: any) => { const s = v == null ? '' : String(v).trim(); if (s && s !== '0' && s !== '-') rows.push(`${label}: ${s}`); };
  push(l.stock, car.stock_no);
  push(l.price, money(car.price_usd));
  push(l.mileage, km(car.mileage_km));
  push(l.engine, car.engine);
  push(l.fuel, car.fuel_type);
  push(l.transmission, car.transmission);
  push(l.steering, car.steering && car.steering !== 'unknown' ? car.steering : '');
  push(l.color, car.color);
  push(l.location, car.location);
  push(l.status, 'Available');
  const max = Math.max(3, Number(opts.maxLines || 9));
  const canHelp = [l.photos, l.shipping, l.similar, l.cheaper].map((x) => `- ${x}`).join('\n');
  return `${head}\n${rows.slice(0, max).join('\n')}\n\n${l.canHelp}:\n${canHelp}`;
}

/** Up to `limit` real alternatives, ranked: same model -> same brand -> same category -> close price. */
export function alternatives(cars: AnyCar[], like?: AnyCar | null, opts: { limit?: number; maxPrice?: number | null } = {}) {
  const limit = Math.max(1, Math.min(3, Number(opts.limit || 3)));
  const base = Number(like?.price_usd || 0);
  const sameId = Number(like?.id || 0);
  const score = (c: AnyCar) => {
    let s = 0;
    if (like?.model && String(c.model || '').toLowerCase() === String(like.model).toLowerCase()) s += 8;
    if (like?.brand && String(c.brand || '').toLowerCase() === String(like.brand).toLowerCase()) s += 4;
    if (like?.category && String(c.category || '') === String(like.category || '')) s += 2;
    if (base > 0 && Number(c.price_usd) > 0) s += Math.max(0, 3 - Math.abs(Number(c.price_usd) - base) / Math.max(1000, base * 0.25));
    return s;
  };
  return (cars || [])
    .filter((c) => Number(c.id || 0) !== sameId)
    .filter((c) => (opts.maxPrice == null ? true : Number(c.price_usd) > 0 && Number(c.price_usd) <= Number(opts.maxPrice)))
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => b.s - a.s || Number(b.c.model_year || 0) - Number(a.c.model_year || 0))
    .slice(0, limit)
    .map((x) => x.c);
}

export function alternativeLines(cars: AnyCar[], lang = 'en') {
  const l = L(lang);
  if (!cars?.length) return '';
  return `${l.alternatives}:\n${cars.map((c) => `- ${carTitle(c)}${money(c.price_usd) ? ` - ${money(c.price_usd)}` : ''}`).join('\n')}`;
}

/** ONE concise clarification when the vehicle truly cannot be resolved (never a vague hold). */
export function clarifyVehicle(lang = 'en') { return L(lang).askVehicle; }
export function clarifyDestination(lang = 'en') { return L(lang).askDestination; }
